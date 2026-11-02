import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileQuery,
  parseResults,
  retryAt,
  safeUrl,
  searchWeb,
  SEARCH_ENDPOINT,
  validateQuery,
} from '../src/lib/api';
import { cacheFor, normalizeState, remember } from '../src/lib/store';
import { CACHE_TTL, MAX_CACHE, MAX_HISTORY } from '../src/lib/types';
import { recordInLedger, fetchBalance, dayKey } from '../src/lib/billing';

const row = {
  title: '<img src=x onerror=alert(1)>',
  url: 'https://example.com/a',
  snippet: '<script>bad()</script>',
  site_name: 'Example',
  date: '2026-10-01T00:00:00Z',
  summary: 'not for UI',
  content: '',
  site_icon: 'https://tracker.test/a',
  rerank_score: 2.4,
  authority: 3,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('official Search API boundary', () => {
  it('uses the verified endpoint, Bearer header, query and count without AI or content fields', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ results: [row] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const results = await searchWeb('  search site:example.com  ', 'test-key', 10);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(SEARCH_ENDPOINT);
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({
      query: 'search site:example.com',
      count: 10,
      need_content: false,
    });
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(results[0]).toEqual({
      title: row.title,
      url: row.url,
      snippet: row.snippet,
      siteName: 'Example',
      date: row.date,
      summary: row.summary,
      authority: 3,
      score: 2.4,
      content: undefined,
    });
  });
  it('counts Unicode code points and rejects blank or oversized queries before network access', async () => {
    expect(validateQuery('😀'.repeat(128))).toHaveLength(256);
    expect(() => validateQuery('😀'.repeat(129))).toThrow('128');
    expect(() => validateQuery(' \n ')).toThrow();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(searchWeb('test', '', 10)).rejects.toMatchObject({ code: 'key' });
    await expect(searchWeb('test', 'key', 51)).rejects.toMatchObject({ code: 'query' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps text as text, filters unsafe URLs, ignores remote icons, and deduplicates URLs', () => {
    const results = parseResults({
      results: [
        row,
        row,
        { ...row, url: 'javascript:alert(1)' },
        { ...row, url: 'data:text/html,bad' },
        { ...row, url: 'https://user:password@example.com' },
        { ...row, url: 'https://second.example/', date: 'invalid', title: '' },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe(row.title);
    expect(results[1].date).toBeNull();
    expect(results[1].title).toBe('second.example');
    expect(results[0]).not.toHaveProperty('site_icon');
    expect(parseResults({ results: [] })).toEqual([]);
    expect(() => parseResults({ answer: 'an AI answer' })).toThrow();
    expect(() => parseResults({ results: [{ url: 'javascript:bad()' }] })).toThrow();
    expect(safeUrl('chrome://extensions')).toBeNull();
  });
  it.each([
    [401, 'key'],
    [402, 'balance'],
    [429, 'rate'],
    [408, 'timeout'],
    [504, 'timeout'],
    [500, 'server'],
    [400, 'request'],
    [403, 'request'],
  ])('maps HTTP %i to %s without exposing raw server errors', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('secret raw error', {
          status: Number(status),
          headers: { 'Retry-After': '4' },
        }),
      ),
    );
    await expect(searchWeb('hello', 'key', 10)).rejects.toMatchObject({ code });
    try {
      await searchWeb('hello', 'key', 10);
    } catch (e) {
      expect((e as Error).message).not.toContain('secret');
    }
  });
  it('understands both Retry-After formats and bounds invalid values', () => {
    const now = Date.parse('2026-10-22T00:00:00Z');
    expect(retryAt('8', now)).toBe(now + 8000);
    expect(retryAt('Thu, 22 Oct 2026 00:00:20 GMT', now)).toBe(now + 20_000);
    expect(retryAt(null, now)).toBe(now + 10_000);
    expect(retryAt('nope', now)).toBe(now + 10_000);
    expect(retryAt('-1', now)).toBe(now + 1000);
    expect(retryAt('9999999', now)).toBe(now + 86_400_000);
  });
  it('handles malformed success JSON and network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{bad', { status: 200 })));
    await expect(searchWeb('hi', 'key', 10)).rejects.toMatchObject({ code: 'schema' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(searchWeb('hi', 'key', 10)).rejects.toMatchObject({ code: 'network' });
  });
  it('supports abort and enforces the 25 second timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const controller = new AbortController();
    const promise = searchWeb('hi', 'key', 10, controller.signal);
    const cancelled = expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await cancelled;
    const timeout = searchWeb('hi', 'key', 10);
    const timedOut = expect(timeout).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(25_000);
    await timedOut;
  });
});
describe('bounded local data', () => {
  it('only reuses exact query/count pairs inside a fixed 15 minute TTL', () => {
    const state = normalizeState({});
    state.cache = [{ query: 'Hello', count: 10, at: 100, results: [] }];
    expect(cacheFor(state, 'Hello', 10, 100 + CACHE_TTL - 1)).toBeDefined();
    expect(cacheFor(state, 'Hello', 10, 100 + CACHE_TTL)).toBeUndefined();
    expect(cacheFor(state, 'Hello', 10, 0)).toBeUndefined();
    expect(cacheFor(state, 'hello', 10, 101)).toBeUndefined();
    expect(cacheFor(state, 'Hello', 20, 101)).toBeUndefined();
    state.settings.cacheEnabled = false;
    expect(cacheFor(state, 'Hello', 10, 101)).toBeUndefined();
  });
  it('caps, deduplicates, and respects clearing data while a request is running', () => {
    let state = normalizeState({});
    for (let i = 0; i < 70; i++)
      state = remember(state, { query: `q${i}`, count: 10, at: i, results: [] }, 0);
    expect(state.history).toHaveLength(MAX_HISTORY);
    expect(state.cache).toHaveLength(MAX_CACHE);
    state = remember(state, { query: 'q69', count: 10, at: 71, results: [] }, 0);
    expect(state.history.filter((h) => h.query === 'q69')).toHaveLength(1);
    const cleared = { ...state, privacyRevision: 1, history: [], cache: [] };
    expect(remember(cleared, { query: 'old', count: 10, at: 72, results: [] }, 0)).toBe(cleared);
    const disabled = {
      ...state,
      settings: { ...state.settings, historyEnabled: false, cacheEnabled: false },
    };
    expect(remember(disabled, { query: 'hello', count: 10, at: 72, results: [] }, 0)).toMatchObject(
      { history: [], cache: [] },
    );
  });
  it('recovers defaults and excludes invalid local links', () => {
    expect(normalizeState({}).settings).toMatchObject({ count: 10, theme: 'system' });
    expect(
      normalizeState({ links: [{ id: '1', title: 'bad', url: 'javascript:bad' }] }).links,
    ).toEqual([]);
  });
});

describe('advanced search filters', () => {
  const defaults = normalizeState({}).settings;
  it('compiles official operators and rejects malformed or oversized filters', () => {
    expect(
      compileQuery('新闻', {
        ...defaults,
        site: 'example.com',
        excludeSite: 'bad.example',
        language: 'zh,en',
        after: '2026-01-01',
        before: '2026-12-31',
        exactPhrase: 'deep search',
        excludeTerms: '广告 推广',
      }),
    ).toBe(
      '新闻 site:example.com -site:bad.example lang:zh,en after:2026-01-01 before:2026-12-31 "deep search" -广告 -推广',
    );
    expect(() => compileQuery('x', { ...defaults, site: 'example.com OR evil' })).toThrow();
    expect(() => compileQuery('x', { ...defaults, language: 'zh OR site:x' })).toThrow();
    expect(() => compileQuery('x', { ...defaults, after: '2026-02-30' })).toThrow();
    expect(() => compileQuery('x'.repeat(128), { ...defaults, site: 'example.com' })).toThrow(
      '128',
    );
  });
  it('keeps old settings and validates arbitrary supported counts', () => {
    expect(normalizeState({}).settings).toMatchObject({
      site: '',
      showScores: false,
      showSummary: false,
    });
    expect(normalizeState({ settings: { ...defaults, count: 37 } }).settings.count).toBe(37);
    expect(normalizeState({ settings: { ...defaults, count: 51 } }).settings.count).toBe(10);
  });
});

describe('advanced request options', () => {
  it('sends explicit localization and original question and bounds returned body', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [{ ...row, content: 'a'.repeat(14000) }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const results = await searchWeb('hello site:example.com', 'test-key', 50, undefined, {
      localization: '203.0.113.4',
      needContent: true,
      originalQuestion: 'hello',
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      query: 'hello site:example.com',
      count: 50,
      need_content: true,
      localization: '203.0.113.4',
      ori_question: 'hello',
    });
    expect(results[0].content).toHaveLength(12000);
    await expect(
      searchWeb('hello', 'test-key', 10, undefined, { localization: '999.1.1.1' }),
    ).rejects.toThrow('IPv4');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('billing data boundaries', () => {
  it('aggregates only counts by local day without query or key data', () => {
    const at = new Date(2026, 10, 2, 12).getTime();
    let data = recordInLedger(undefined, 'results', at);
    data = recordInLedger(data, 'failed', at + 1000);
    data = recordInLedger(data, 'empty', at + 2000);
    expect(data.trackingSince).toBe(at);
    expect(data.days).toEqual([{ day: dayKey(at), results: 1, empty: 1, failed: 1, cancelled: 0 }]);
    expect(JSON.stringify(data)).not.toContain('test-key');
  });
  it('uses the official balance endpoint with narrow request handling and validates responses', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '12.50',
              granted_balance: '2.00',
              topped_up_balance: '10.50',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(fetchBalance('test-key')).resolves.toEqual({
      available: true,
      rows: [{ currency: 'CNY', total: '12.50', granted: '2.00', toppedUp: '10.50' }],
    });
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/user/balance');
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [{ currency: '<svg>', total_balance: 'bad' }],
        }),
        { status: 200 },
      ),
    );
    await expect(fetchBalance('test-key')).rejects.toThrow('格式');
  });
});
