import {
  CACHE_TTL,
  DEFAULT_LINKS,
  DEFAULT_SETTINGS,
  MAX_CACHE,
  MAX_HISTORY,
  type CacheEntry,
  type LocalState,
  type Settings,
  type QuickLink,
  type SearchResult,
  type Theme,
} from './types';
import { safeUrl } from './api';

export function normalizeState(raw: Partial<LocalState>): LocalState {
  const input = raw.settings;
  const settings: Settings = {
    theme:
      input && ['system', 'light', 'dark'].includes(input.theme)
        ? input.theme
        : DEFAULT_SETTINGS.theme,
    count: input && [5, 10, 20].includes(input.count) ? input.count : 10,
    historyEnabled: typeof input?.historyEnabled === 'boolean' ? input.historyEnabled : true,
    cacheEnabled: typeof input?.cacheEnabled === 'boolean' ? input.cacheEnabled : true,
    openNewTab: typeof input?.openNewTab === 'boolean' ? input.openNewTab : true,
  };
  return {
    settings,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    links: Array.isArray(raw.links)
      ? raw.links
          .filter(
            (l): l is QuickLink =>
              !!l && typeof l.id === 'string' && typeof l.title === 'string' && !!safeUrl(l.url),
          )
          .slice(0, 8)
      : DEFAULT_LINKS,
    history:
      settings.historyEnabled && Array.isArray(raw.history)
        ? raw.history
            .filter(
              (h) =>
                h &&
                typeof h.query === 'string' &&
                [...h.query].length <= 128 &&
                Number.isFinite(h.at),
            )
            .slice(0, MAX_HISTORY)
        : [],
    cache:
      settings.cacheEnabled && Array.isArray(raw.cache)
        ? raw.cache
            .filter(
              (c) =>
                c &&
                typeof c.query === 'string' &&
                Number.isFinite(c.at) &&
                [5, 10, 20].includes(c.count) &&
                Array.isArray(c.results),
            )
            .slice(0, MAX_CACHE)
            .map((c) => ({
              ...c,
              results: c.results
                .filter(
                  (r): r is SearchResult =>
                    !!r &&
                    typeof r.title === 'string' &&
                    typeof r.snippet === 'string' &&
                    !!safeUrl(r.url),
                )
                .slice(0, c.count)
                .map((r) => ({
                  ...r,
                  siteName: typeof r.siteName === 'string' ? r.siteName : null,
                  date:
                    typeof r.date === 'string' && Number.isFinite(Date.parse(r.date))
                      ? r.date
                      : null,
                })),
            }))
        : [],
    cooldownUntil: Number.isFinite(raw.cooldownUntil) ? raw.cooldownUntil! : 0,
    privacyRevision: Number.isFinite(raw.privacyRevision) ? raw.privacyRevision! : 0,
    lastRequestAt: Number.isFinite(raw.lastRequestAt) ? raw.lastRequestAt! : 0,
  };
}
export async function initialize(): Promise<LocalState> {
  if (!globalThis.chrome?.storage?.local)
    throw new Error('请通过 chrome://extensions 加载扩展后打开新标签页。');
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return readState();
}
export async function readState(): Promise<LocalState> {
  return normalizeState((await chrome.storage.local.get(null)) as Partial<LocalState>);
}
// Web Locks serialize read-modify-write operations across every SeekTab tab.
export async function updateState(change: (state: LocalState) => LocalState): Promise<LocalState> {
  return navigator.locks.request('seektab-data-v1', async () => {
    const state = change(await readState());
    await chrome.storage.local.set(state);
    return state;
  });
}
export function cacheFor(
  state: LocalState,
  query: string,
  count: number,
  now = Date.now(),
): CacheEntry | undefined {
  return state.settings.cacheEnabled
    ? state.cache.find(
        (c) => c.query === query && c.count === count && now >= c.at && now - c.at < CACHE_TTL,
      )
    : undefined;
}
export function remember(state: LocalState, entry: CacheEntry, revision: number): LocalState {
  if (state.privacyRevision !== revision) return state;
  return {
    ...state,
    history: state.settings.historyEnabled
      ? [
          { query: entry.query, at: entry.at },
          ...state.history.filter((h) => h.query !== entry.query),
        ].slice(0, MAX_HISTORY)
      : [],
    cache: state.settings.cacheEnabled
      ? [
          entry,
          ...state.cache.filter(
            (c) =>
              !(c.query === entry.query && c.count === entry.count) && entry.at - c.at < CACHE_TTL,
          ),
        ].slice(0, MAX_CACHE)
      : [],
  };
}
export async function savePreferences(settings: Settings, key: string): Promise<LocalState> {
  const trimmed = key.trim();
  if (trimmed.length > 512 || /\s/.test(trimmed))
    throw new Error('API Key 格式不正确，请仅粘贴密钥本身。');
  const state = await updateState((s) => ({
    ...s,
    settings,
    apiKey: trimmed,
    history: settings.historyEnabled ? s.history : [],
    cache: settings.cacheEnabled ? s.cache : [],
    privacyRevision:
      s.privacyRevision +
      (settings.historyEnabled !== s.settings.historyEnabled ||
      settings.cacheEnabled !== s.settings.cacheEnabled
        ? 1
        : 0),
  }));
  localStorage.setItem('seektab-theme', settings.theme);
  return state;
}
export async function clearData(kind: 'history' | 'cache' | 'all'): Promise<LocalState> {
  return updateState((s) => ({
    ...s,
    history: kind === 'history' || kind === 'all' ? [] : s.history,
    cache: kind === 'cache' || kind === 'all' ? [] : s.cache,
    privacyRevision: s.privacyRevision + 1,
  }));
}
export async function setTheme(theme: Theme): Promise<void> {
  await updateState((s) => ({ ...s, settings: { ...s.settings, theme } }));
  localStorage.setItem('seektab-theme', theme);
}
export async function removeApiKey(): Promise<void> {
  await updateState((s) => ({ ...s, apiKey: '' }));
}
