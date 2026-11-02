import { describe, expect, it } from 'vitest';
import { display, enabledSources, matches } from '../src/lib/browser';
import { normalizeState } from '../src/lib/store';

describe('browser sources', () => {
  it('matches every term against title and URL, case-insensitively', () => {
    const item = { title: 'Azure Architecture Center', url: 'https://learn.microsoft.com/azure' };
    expect(matches(item, 'azure center')).toBe(true);
    expect(matches(item, 'AZURE microsoft')).toBe(true);
    expect(matches(item, 'azure aws')).toBe(false);
    expect(matches(item, '   ')).toBe(false);
  });
  it('shows URLs without scheme or trailing slash', () => {
    expect(display('https://example.com/')).toBe('example.com');
    expect(display('http://a.test/x?y=1')).toBe('a.test/x?y=1');
  });
  it('defaults to every source and respects toggles and invalid stored values', () => {
    const defaults = normalizeState({}).settings;
    expect(defaults).toMatchObject({ accent: 'amber', clock12: false });
    expect(enabledSources(defaults)).toEqual(['tabs', 'bookmarks', 'history']);
    const custom = normalizeState({
      settings: { ...defaults, searchBookmarks: false, accent: 'nope' as never },
    }).settings;
    expect(custom.accent).toBe('amber');
    expect(enabledSources(custom)).toEqual(['tabs', 'history']);
  });
});
