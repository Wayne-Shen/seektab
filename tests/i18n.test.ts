import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '../src/lib/en';
import { setLocale, t } from '../src/lib/i18n';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}
describe('i18n', () => {
  it('has an English string for every translated key', () => {
    const missing = new Set<string>();
    for (const file of sources('src').filter((f) => !f.endsWith('en.ts'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g))
        if (!(m[1] in EN)) missing.add(m[1]);
    }
    expect([...missing]).toEqual([]);
  });
  it('keeps placeholders identical in both languages', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [zh, en] of Object.entries(EN)) expect(names(en), zh).toEqual(names(zh));
  });
  it('translates, interpolates and falls back to Chinese', () => {
    setLocale('en');
    expect(t('{n} 秒后重试', { n: 3 })).toBe('Retry in 3 s');
    expect(t('没有翻译的句子')).toBe('没有翻译的句子');
    setLocale('zh');
    expect(t('{n} 秒后重试', { n: 3 })).toBe('3 秒后重试');
  });
});
