import { safeUrl } from './api';
import type { Settings } from './types';

export type SourceId = 'tabs' | 'bookmarks' | 'history';
export interface BrowserItem {
  source: SourceId;
  id: string;
  title: string;
  url: string;
  tabId?: number;
  windowId?: number;
}
export const SOURCE_LIMIT = 4;
const FETCH_LIMIT = 30;

export function enabledSources(s: Settings): SourceId[] {
  return [
    ...(s.searchTabs ? (['tabs'] as const) : []),
    ...(s.searchBookmarks ? (['bookmarks'] as const) : []),
    ...(s.searchHistory ? (['history'] as const) : []),
  ];
}
export function display(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '');
}
export function matches(item: { title: string; url: string }, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${item.title} ${item.url}`.toLowerCase();
  return terms.length > 0 && terms.every((t) => hay.includes(t));
}
// Titles and URLs from other pages are untrusted: they are only ever rendered as text, and
// only HTTP/HTTPS URLs can be opened.
function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
export async function searchTabs(query: string): Promise<BrowserItem[]> {
  const own = chrome.runtime.getURL('');
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => t.id !== undefined && !!t.url && !t.url.startsWith(own))
    .map((t) => ({
      source: 'tabs' as const,
      id: `tab-${t.id}`,
      title: clip(t.title, 200) || display(clip(t.url, 300)),
      url: clip(t.url, 300),
      tabId: t.id,
      windowId: t.windowId,
    }))
    .filter((t) => matches(t, query))
    .slice(0, SOURCE_LIMIT);
}
export async function searchBookmarks(query: string): Promise<BrowserItem[]> {
  const found = await chrome.bookmarks.search(query.slice(0, 128));
  return found
    .filter((b) => !!b.url && !!safeUrl(b.url))
    .slice(0, FETCH_LIMIT)
    .map((b) => ({
      source: 'bookmarks' as const,
      id: `bookmark-${b.id}`,
      title: clip(b.title, 200) || display(clip(b.url, 300)),
      url: safeUrl(b.url!)!,
    }))
    .slice(0, SOURCE_LIMIT);
}
export async function searchChromeHistory(query: string): Promise<BrowserItem[]> {
  const found = await chrome.history.search({
    text: query.slice(0, 128),
    maxResults: FETCH_LIMIT,
    startTime: 0,
  });
  const seen = new Set<string>();
  const items: BrowserItem[] = [];
  for (const h of found) {
    const url = h.url && safeUrl(h.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      source: 'history',
      id: `history-${url}`,
      title: clip(h.title, 200) || display(url),
      url,
    });
    if (items.length === SOURCE_LIMIT) break;
  }
  return items;
}
export async function searchBrowser(
  query: string,
  sources: SourceId[],
): Promise<Record<SourceId, BrowserItem[]>> {
  const run = (id: SourceId, fn: (q: string) => Promise<BrowserItem[]>) =>
    sources.includes(id) ? fn(query).catch(() => []) : Promise.resolve([]);
  const [tabs, bookmarks, history] = await Promise.all([
    run('tabs', searchTabs),
    run('bookmarks', searchBookmarks),
    run('history', searchChromeHistory),
  ]);
  return { tabs, bookmarks, history };
}
export async function activateTab(item: BrowserItem): Promise<void> {
  if (item.tabId === undefined) return;
  await chrome.tabs.update(item.tabId, { active: true });
  if (item.windowId !== undefined) await chrome.windows.update(item.windowId, { focused: true });
}
