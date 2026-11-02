import { t } from './i18n';

class BillingError extends Error {}
import { readState } from './store';

export type Outcome = 'results' | 'empty' | 'failed' | 'cancelled';
export type Counts = Record<Outcome, number>;
export interface DailyUsage extends Counts {
  day: string;
}
export interface BalanceRow {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
}
export interface BillingReport {
  refreshedAt: number;
  balanceAt: number | null;
  balance: BalanceRow[] | null;
  available: boolean | null;
  balanceError: string | null;
  trackingSince: number | null;
  days: DailyUsage[];
}
interface Ledger {
  trackingSince: number | null;
  days: DailyUsage[];
}
const LEDGER_KEY = 'seektab-usage-v1';
const REPORT_KEY = 'seektab-report-v1';
const LOCK = 'seektab-usage-v1';
const MAX_DAYS = 366;
const emptyCounts = (): Counts => ({ results: 0, empty: 0, failed: 0, cancelled: 0 });
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function recordInLedger(raw: Ledger | undefined, outcome: Outcome, at: number): Ledger {
  const days = Array.isArray(raw?.days)
    ? raw.days
        .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.day))
        .map(
          (d) =>
            ({
              day: d.day,
              ...Object.fromEntries(
                Object.keys(emptyCounts()).map((k) => [
                  k,
                  Number.isSafeInteger(d[k as Outcome]) && d[k as Outcome] >= 0
                    ? d[k as Outcome]
                    : 0,
                ]),
              ),
            }) as DailyUsage,
        )
    : [];
  const day = dayKey(at);
  let current = days.find((d) => d.day === day);
  if (!current) {
    current = { day, ...emptyCounts() };
    days.push(current);
  }
  current[outcome] += 1;
  days.sort((a, b) => b.day.localeCompare(a.day));
  return {
    trackingSince:
      typeof raw?.trackingSince === 'number' && Number.isFinite(raw.trackingSince)
        ? raw.trackingSince
        : at,
    days: days.slice(0, MAX_DAYS),
  };
}
export async function recordUsage(outcome: Outcome, at = Date.now()): Promise<void> {
  await navigator.locks.request(LOCK, async () => {
    const raw = await chrome.storage.local.get(LEDGER_KEY);
    await chrome.storage.local.set({
      [LEDGER_KEY]: recordInLedger(raw[LEDGER_KEY] as Ledger | undefined, outcome, at),
    });
  });
}
export async function readBillingReport(): Promise<BillingReport | null> {
  const data = await chrome.storage.local.get(REPORT_KEY);
  return (data[REPORT_KEY] as BillingReport | undefined) ?? null;
}
export async function fetchBalance(
  key: string,
  signal?: AbortSignal,
): Promise<{ rows: BalanceRow[]; available: boolean }> {
  if (!key.trim()) throw new BillingError(t('请先在设置中保存 API Key。'));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new BillingError(t('查询已取消。'));
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch('https://api.deepseek.com/user/balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    if (response.status === 401) throw new BillingError(t('API Key 无效，请检查设置。'));
    if (!response.ok)
      throw new BillingError(t('余额查询失败（HTTP {status}）。', { status: response.status }));
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('is_available' in data) ||
      typeof data.is_available !== 'boolean' ||
      !('balance_infos' in data) ||
      !Array.isArray(data.balance_infos)
    )
      throw new BillingError(t('余额响应格式无效。'));
    const rows: BalanceRow[] = data.balance_infos.map((r: unknown) => {
      if (!r || typeof r !== 'object') throw new BillingError(t('余额响应格式无效。'));
      const row = r as Record<string, unknown>;
      const amount = (v: unknown) => typeof v === 'string' && /^\d{1,18}(?:\.\d{1,8})?$/.test(v);
      if (
        !['CNY', 'USD'].includes(String(row.currency)) ||
        !amount(row.total_balance) ||
        !amount(row.granted_balance) ||
        !amount(row.topped_up_balance)
      )
        throw new BillingError(t('余额响应格式无效。'));
      return {
        currency: row.currency as string,
        total: row.total_balance as string,
        granted: row.granted_balance as string,
        toppedUp: row.topped_up_balance as string,
      };
    });
    return { rows, available: data.is_available };
  } catch (e) {
    if (e instanceof BillingError) throw e;
    throw new BillingError(
      controller.signal.aborted ? t('余额查询已取消或超时。') : t('无法连接 DeepSeek 余额接口。'),
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function refreshBillingReport(signal?: AbortSignal): Promise<BillingReport> {
  const state = await readState();
  let balance: BalanceRow[] | null = null;
  let balanceAt: number | null = null;
  let available: boolean | null = null;
  let balanceError: string | null = null;
  try {
    const result = await fetchBalance(state.apiKey, signal);
    balance = result.rows;
    available = result.available;
    balanceAt = Date.now();
  } catch (e) {
    if (signal?.aborted) throw e;
    balanceError = e instanceof Error ? e.message : t('余额查询失败。');
  }
  return navigator.locks.request(LOCK, async () => {
    const data = await chrome.storage.local.get(LEDGER_KEY);
    const raw = data[LEDGER_KEY] as Ledger | undefined;
    const ledger: Ledger = raw && Array.isArray(raw.days) ? raw : { trackingSince: null, days: [] };
    const report: BillingReport = {
      refreshedAt: Date.now(),
      balanceAt,
      balance,
      available,
      balanceError,
      trackingSince: ledger.trackingSince,
      days: ledger.days.slice(0, MAX_DAYS),
    };
    await chrome.storage.local.set({ [REPORT_KEY]: report });
    return report;
  });
}
