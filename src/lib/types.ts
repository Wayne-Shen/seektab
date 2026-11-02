export type Locale = 'zh' | 'en';
export const AI_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;
export type AiModel = (typeof AI_MODELS)[number];
export const AI_TOKEN_CHOICES = [2000, 4000, 8000] as const;
export type SortBy = 'relevance' | 'date';
export type Theme = 'system' | 'light' | 'dark';
export const ACCENTS = ['amber', 'sky', 'mint', 'coral'] as const;
export type Accent = (typeof ACCENTS)[number];
export interface Settings {
  theme: Theme;
  count: number;
  historyEnabled: boolean;
  cacheEnabled: boolean;
  openNewTab: boolean;
  site: string;
  excludeSite: string;
  language: string;
  after: string;
  before: string;
  exactPhrase: string;
  excludeTerms: string;
  showSummary: boolean;
  showScores: boolean;
  localization: string;
  needContent: boolean;
  accent: Accent;
  locale: Locale;
  sortBy: SortBy;
  aiEnabled: boolean;
  aiAcknowledged: boolean;
  aiModel: AiModel;
  aiSources: number;
  aiMaxTokens: number;
  aiDailyCap: number;
  clock12: boolean;
  searchTabs: boolean;
  searchBookmarks: boolean;
  searchHistory: boolean;
}
export interface QuickLink {
  id: string;
  title: string;
  url: string;
}
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  siteName: string | null;
  summary?: string;
  content?: string;
  authority?: number | null;
  score?: number | null;
  date: string | null;
}
export interface HistoryItem {
  query: string;
  at: number;
}
export interface CacheEntry {
  query: string;
  count: number;
  at: number;
  results: SearchResult[];
}
export interface LocalState {
  settings: Settings;
  apiKey: string;
  links: QuickLink[];
  history: HistoryItem[];
  cache: CacheEntry[];
  cooldownUntil: number;
  privacyRevision: number;
  lastRequestAt: number;
}
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  count: 10,
  historyEnabled: true,
  cacheEnabled: true,
  openNewTab: true,
  site: '',
  excludeSite: '',
  language: '',
  after: '',
  before: '',
  exactPhrase: '',
  excludeTerms: '',
  showSummary: false,
  showScores: false,
  localization: '',
  needContent: false,
  accent: 'amber',
  locale: 'zh',
  sortBy: 'relevance',
  aiEnabled: true,
  aiAcknowledged: false,
  aiModel: 'deepseek-flash',
  aiSources: 8,
  aiMaxTokens: 4000,
  aiDailyCap: 20,
  clock12: false,
  searchTabs: true,
  searchBookmarks: true,
  searchHistory: true,
};
export const DEFAULT_LINKS: QuickLink[] = [
  { id: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'github', title: 'GitHub', url: 'https://github.com/' },
  { id: 'notion', title: 'Notion', url: 'https://www.notion.so/' },
  { id: 'bilibili', title: '哔哩哔哩', url: 'https://www.bilibili.com/' },
];
export const CACHE_TTL = 15 * 60 * 1000;
export const MAX_CACHE = 20;
export const MAX_HISTORY = 50;
