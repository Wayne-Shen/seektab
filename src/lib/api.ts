import type { SearchResult } from './types';

export const SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search';
export class SearchError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAt = 0,
  ) {
    super(message);
    this.name = 'SearchError';
  }
}
export function validateQuery(value: string): string {
  const query = value.trim();
  if (!query) throw new SearchError('query', '先输入你想探索的内容。');
  if ([...query].length > 128)
    throw new SearchError('query', '搜索词最多为 128 个字符，请缩短后重试。');
  return query;
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.slice(0, limit) : '';
export function parseResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results))
    throw new SearchError('schema', '搜索服务返回了无法识别的数据，请稍后重试。');
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const item of data.results.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const url = safeUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: text(item.title, 500) || new URL(url).hostname,
      url,
      snippet: text(item.snippet, 2000),
      siteName: text(item.site_name, 200) || null,
      date:
        typeof item.date === 'string' && Number.isFinite(Date.parse(item.date)) ? item.date : null,
    });
  }
  if (data.results.length && !results.length)
    throw new SearchError('schema', '返回结果中没有安全、可用的网页链接。');
  return results;
}
export function retryAt(header: string | null, now = Date.now()): number {
  const seconds = header === null ? NaN : Number(header);
  const delay =
    header !== null && Number.isFinite(seconds)
      ? seconds * 1000
      : header
        ? Date.parse(header) - now
        : NaN;
  return now + Math.min(86_400_000, Math.max(1000, Number.isFinite(delay) ? delay : 10_000));
}
export async function searchWeb(
  query: string,
  key: string,
  count: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  query = validateQuery(query);
  if (!key.trim()) throw new SearchError('key', '添加你的 DeepSeek API Key，即可开始搜索。');
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new SearchError('query', '返回条数应在 1–50 之间。');
  if (signal?.aborted) throw new SearchError('cancelled', '搜索已取消。');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 25_000);
  try {
    const response = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, count, need_content: false }),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    // Never surface the provider's raw error text: it may contain user or credential data.
    if (response.status === 401)
      throw new SearchError('key', 'API Key 无效或已失效，请在设置中更新。');
    if (response.status === 402)
      throw new SearchError('balance', 'DeepSeek 账户余额不足，请充值后重试。');
    if (response.status === 429)
      throw new SearchError(
        'rate',
        '搜索请求有点频繁，稍等片刻再试。',
        retryAt(response.headers.get('Retry-After')),
      );
    if (response.status === 408 || response.status === 504)
      throw new SearchError('timeout', '搜索服务响应超时，请稍后重试。');
    if (response.status >= 500)
      throw new SearchError('server', 'DeepSeek 搜索暂时不可用，请稍后重试。');
    if (!response.ok)
      throw new SearchError(
        'request',
        `搜索请求未被接受（HTTP ${response.status}），请检查设置或稍后重试。`,
      );
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SearchError('schema', '搜索服务返回了无法识别的数据，请稍后重试。');
    }
    return parseResults(data).slice(0, count);
  } catch (error) {
    if (error instanceof SearchError) throw error;
    if (controller.signal.aborted)
      throw new SearchError(
        timedOut ? 'timeout' : 'cancelled',
        timedOut ? '搜索超过 25 秒，请检查网络后重试。' : '搜索已取消。',
      );
    throw new SearchError('network', '无法连接 DeepSeek，请检查网络连接及扩展的网站访问权限。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
