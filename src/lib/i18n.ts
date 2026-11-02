import { EN } from './en';
import type { Locale } from './types';

export type { Locale };
let current: Locale = 'zh';
export function setLocale(locale: Locale) {
  current = locale;
}
export function getLocale(): Locale {
  return current;
}
export function normalizeLocale(value: unknown, fallback?: string): Locale {
  if (value === 'zh' || value === 'en') return value;
  return (fallback ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
// Chinese source text is the key; English comes from `en.ts`. `{name}` placeholders are filled from vars.
export function t(zh: string, vars?: Record<string, string | number>): string {
  const text = current === 'en' ? (EN[zh] ?? zh) : zh;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}
