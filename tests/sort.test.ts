import { describe, expect, it } from 'vitest';
import { sortResults } from '../src/lib/api';
import { normalizeState } from '../src/lib/store';
import type { SearchResult } from '../src/lib/types';

const r = (title: string, date: string | null, score?: number): SearchResult => ({
  title,
  url: `https://example.com/${title}`,
  snippet: '',
  siteName: null,
  date,
  ...(score === undefined ? {} : { score }),
});
const titles = (list: SearchResult[]) => list.map((x) => x.title);
describe('sortResults', () => {
  const list = [
    r('a', '2026-01-01T00:00:00Z', 1.5),
    r('b', null, 2.5),
    r('c', '2026-03-01T00:00:00Z', 2.5),
    r('d', '2026-03-01T00:00:00Z', 1.0),
  ];
  it('sorts by relevance score, keeping provider order for ties', () => {
    expect(titles(sortResults(list, 'relevance'))).toEqual(['b', 'c', 'a', 'd']);
  });
  it('keeps provider order when no scores exist', () => {
    expect(
      titles(
        sortResults(
          list.map(({ score: _s, ...x }) => x),
          'relevance',
        ),
      ),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
  it('sorts by date, newest first, undated last, stable on ties', () => {
    expect(titles(sortResults(list, 'date'))).toEqual(['c', 'd', 'a', 'b']);
  });
  it('does not mutate the input and defaults the setting', () => {
    const copy = [...list];
    sortResults(list, 'date');
    expect(list).toEqual(copy);
    expect(normalizeState({}).settings.sortBy).toBe('relevance');
    expect(
      normalizeState({ settings: { ...normalizeState({}).settings, sortBy: 'x' as never } })
        .settings.sortBy,
    ).toBe('relevance');
  });
});
