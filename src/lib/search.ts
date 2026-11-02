import { searchWeb, SearchError, validateQuery, compileQuery } from './api';
import { cacheFor, readState, remember, updateState } from './store';
import type { SearchResult } from './types';
import { recordUsage, type Outcome } from './billing';

export interface SearchResponse {
  results: SearchResult[];
  fromCache: boolean;
  at: number;
  persistenceWarning: boolean;
}
async function networkRequest(
  query: string,
  key: string,
  count: number,
  signal: AbortSignal,
  options: { localization?: string; needContent?: boolean; originalQuestion?: string } = {},
) {
  const state = await readState();
  if (state.cooldownUntil > Date.now())
    throw new SearchError('rate', '搜索请求有点频繁，稍等片刻再试。', state.cooldownUntil);
  // A small shared gap protects this installation across concurrent new tabs.
  const wait = Math.max(0, state.lastRequestAt + 300 - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  if (signal.aborted) throw new SearchError('cancelled', '搜索已取消。');
  await updateState((s) => ({ ...s, lastRequestAt: Date.now() }));
  let started = false;
  let outcome: Outcome = 'failed';
  try {
    const results = await searchWeb(query, key, count, signal, {
      ...options,
      onRequest: () => {
        started = true;
      },
    });
    outcome = results.length ? 'results' : 'empty';
    return results;
  } catch (error) {
    if (error instanceof SearchError && error.code === 'cancelled') outcome = 'cancelled';
    if (error instanceof SearchError && error.code === 'rate')
      await updateState((s) => ({ ...s, cooldownUntil: Math.max(s.cooldownUntil, error.retryAt) }));
    throw error;
  } finally {
    if (started) await recordUsage(outcome).catch(() => {});
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
    const effectiveQuery = compileQuery(query, state.settings);
    const advancedRequest =
      !!state.settings.localization || state.settings.needContent || effectiveQuery !== query;
    const cached =
      !refresh && !advancedRequest
        ? cacheFor(state, effectiveQuery, state.settings.count)
        : undefined;
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
    const results = await networkRequest(
      effectiveQuery,
      state.apiKey,
      state.settings.count,
      signal,
      {
        localization: state.settings.localization.trim(),
        needContent: state.settings.needContent,
        originalQuestion: effectiveQuery !== query ? query : undefined,
      },
    );
    if (signal.aborted) throw new SearchError('cancelled', '搜索已取消。');
    const at = Date.now();
    let persistenceWarning = false;
    try {
      await updateState((s) =>
        advancedRequest
          ? {
              ...remember(
                s,
                { query, count: state.settings.count, at, results: [] },
                state.privacyRevision,
              ),
              cache: s.cache,
            }
          : remember(s, { query, count: state.settings.count, at, results }, state.privacyRevision),
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
