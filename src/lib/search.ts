import { searchWeb, SearchError, validateQuery } from './api';
import { cacheFor, readState, remember, updateState } from './store';
import type { SearchResult } from './types';

export interface SearchResponse {
  results: SearchResult[];
  fromCache: boolean;
  at: number;
  persistenceWarning: boolean;
}
async function networkRequest(query: string, key: string, count: number, signal: AbortSignal) {
  const state = await readState();
  if (state.cooldownUntil > Date.now())
    throw new SearchError('rate', '搜索请求有点频繁，稍等片刻再试。', state.cooldownUntil);
  // A small shared gap protects this installation across concurrent new tabs.
  const wait = Math.max(0, state.lastRequestAt + 300 - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  if (signal.aborted) throw new SearchError('cancelled', '搜索已取消。');
  await updateState((s) => ({ ...s, lastRequestAt: Date.now() }));
  try {
    return await searchWeb(query, key, count, signal);
  } catch (error) {
    if (error instanceof SearchError && error.code === 'rate')
      await updateState((s) => ({ ...s, cooldownUntil: Math.max(s.cooldownUntil, error.retryAt) }));
    throw error;
  }
}
export async function runSearch(
  value: string,
  signal: AbortSignal,
  refresh = false,
): Promise<SearchResponse> {
  const query = validateQuery(value);
  // Only extension pages can call this module; there is no content-script bridge.
  return navigator.locks.request('seektab-network-v1', { signal }, async () => {
    const state = await readState();
    const cached = !refresh ? cacheFor(state, query, state.settings.count) : undefined;
    if (cached) {
      let persistenceWarning = false;
      try {
        await updateState((s) =>
          s.privacyRevision !== state.privacyRevision
            ? s
            : {
                ...s,
                history: s.settings.historyEnabled
                  ? [
                      { query, at: Date.now() },
                      ...s.history.filter((h) => h.query !== query),
                    ].slice(0, 50)
                  : [],
              },
        );
      } catch {
        persistenceWarning = true;
      }
      return { results: cached.results, fromCache: true, at: cached.at, persistenceWarning };
    }
    const results = await networkRequest(query, state.apiKey, state.settings.count, signal);
    if (signal.aborted) throw new SearchError('cancelled', '搜索已取消。');
    const at = Date.now();
    let persistenceWarning = false;
    try {
      await updateState((s) =>
        remember(s, { query, count: state.settings.count, at, results }, state.privacyRevision),
      );
    } catch {
      persistenceWarning = true;
    }
    return { results, fromCache: false, at, persistenceWarning };
  });
}
export async function testConnection(key: string, signal: AbortSignal): Promise<number> {
  return navigator.locks.request('seektab-network-v1', { signal }, async () => {
    const start = performance.now();
    await networkRequest('DeepSeek', key, 1, signal);
    return Math.round(performance.now() - start);
  });
}
