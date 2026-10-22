import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Runs against a real unpacked MV3 extension, with API traffic intercepted.
// A real key and billable network access are deliberately unnecessary.
const extensionPath = path.resolve('dist');
const extensionId = createHash('sha256')
  .update(extensionPath)
  .digest('hex')
  .slice(0, 32)
  .replace(/./g, (h) => String.fromCharCode(97 + parseInt(h, 16)));
const profile = await mkdtemp(path.join(os.tmpdir(), 'seektab-e2e-'));
const artifacts = path.resolve('test-artifacts');
await mkdir(artifacts, { recursive: true });
let context;
const checks = [];
const record = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const fixture = {
  results: [
    {
      title: '探索开放网络，发现新的可能',
      url: 'https://example.com/discover',
      snippet:
        '这是仅供自动化测试的搜索结果。SeekTab 将网页标题、摘要、来源与时间清晰呈现，让每一次发现都有迹可循。',
      site_name: 'Example · 测试来源',
      date: '2026-10-20T08:30:00Z',
      site_icon: 'https://tracking.invalid/pixel',
      summary: '',
      content: '',
      authority: 2,
      rerank_score: 2.2,
    },
    {
      title: '把好奇心变成下一次行动',
      url: 'https://docs.example.com/guide',
      snippet: '使用站点、语言和日期条件，找到更贴近问题的内容。测试数据不会随正式扩展发布。',
      site_name: null,
      date: null,
      site_icon: null,
      summary: '',
      content: '',
      authority: 1,
      rerank_score: 2,
    },
    {
      title: 'SeekTab：一个只属于你的搜索空间',
      url: 'https://search.example.com/',
      snippet: '本地历史、短期缓存、自定义快捷链接，以及随心切换的明亮与深色界面。',
      site_name: '搜索体验实验室',
      date: '2026-10-18T00:00:00Z',
      summary: '',
      content: '',
      site_icon: null,
      authority: -1,
      rerank_score: 1.6,
    },
  ],
};
let mode = 'success';
let calls = [];
let foreignRequests = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route('https://api.deepseek.com/**', async (route) => {
    const request = route.request();
    calls.push({
      url: request.url(),
      data: request.postDataJSON(),
      authorization: request.headers().authorization,
    });
    if (mode === 'delay') {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (mode === '401')
      return route.fulfill({
        status: 401,
        body: JSON.stringify({ error: { message: 'RAW-PRIVATE-ERROR' } }),
      });
    if (mode === '402') return route.fulfill({ status: 402, body: '{}' });
    if (mode === '429')
      return route.fulfill({ status: 429, headers: { 'Retry-After': '2' }, body: '{}' });
    if (mode === '500') return route.fulfill({ status: 500, body: '{}' });
    if (mode === 'offline') return route.abort('internetdisconnected');
    if (mode === 'bad-json') return route.fulfill({ status: 200, body: '{bad' });
    const body =
      mode === 'empty'
        ? { results: [] }
        : mode === 'unsafe'
          ? {
              results: [
                {
                  ...fixture.results[0],
                  title: '<img src=x onerror=alert(1)>',
                  snippet: '<script>alert(1)</script>',
                },
                { ...fixture.results[0], url: 'javascript:alert(1)' },
              ],
            }
          : fixture;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  context.on('request', (req) => {
    if (/^https?:/.test(req.url()) && !req.url().startsWith('https://api.deepseek.com/'))
      foreignRequests.push(req.url());
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('heading', { name: '好奇心，从这里开始。' })).toBeVisible();
  await expect(page.getByText('连接你的搜索引擎', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'home-light.png') });
  record('Unpacked MV3 loads with local assets and first-run onboarding');

  // Check Chrome's actual new-tab override in this isolated profile.
  const newtab = await context.newPage();
  await newtab.goto('chrome://newtab');
  await expect(newtab.getByRole('button', { name: 'SeekTab 首页' })).toBeVisible();
  await newtab.close();
  record('chrome://newtab is overridden by SeekTab');

  await page.getByRole('button', { name: '切换深色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(artifacts, 'home-dark.png') });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换浅色主题' }).click();
  record('Light/dark preference persists after reload');

  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('DeepSeek API Key', { exact: true }).fill('test-only-not-a-real-key');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText(/连接成功 · 搜索接口可用/)).toBeVisible();
  expect(calls.at(-1).data).toEqual({ query: 'DeepSeek', count: 1, need_content: false });
  let data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.apiKey || '').toBe('');
  expect(data.history || []).toHaveLength(0);
  expect(data.cache || []).toHaveLength(0);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('连接你的搜索引擎', { exact: true })).toHaveCount(0);
  record('Search endpoint connection test is isolated from key persistence/history/cache');

  await page.getByRole('button', { name: '打开设置' }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await expect
    .poll(() => page.locator('dialog').evaluate((d) => d.scrollWidth <= d.clientWidth))
    .toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'settings-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.screenshot({ path: path.join(artifacts, 'settings.png') });
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 80 } });
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: '搜索网页', exact: true })).toBeFocused();
  record('Settings stay usable at 320px; native modal Escape and search shortcut work');

  const submit = async (q) => {
    await page.getByRole('textbox', { name: '搜索网页', exact: true }).fill(q);
    await page.getByRole('button', { name: '提交搜索' }).click();
  };
  await submit('寻找下一次发现');
  await expect(page.locator('.result-card')).toHaveCount(3);
  expect(calls.at(-1)).toEqual({
    url: 'https://api.deepseek.com/v1/tools/search',
    data: { query: '寻找下一次发现', count: 10, need_content: false },
    authorization: 'Bearer test-only-not-a-real-key',
  });
  await expect(page.locator('.result-card').first().locator('time')).toContainText('2026');
  await expect(page.locator('.result-card').nth(1).locator('time')).toHaveCount(0);
  await expect(page.locator('.result-card').first().getByRole('link').first()).toHaveAttribute(
    'target',
    '_blank',
  );
  await page.screenshot({ path: path.join(artifacts, 'results-light.png'), fullPage: true });
  record('Verified request contract and result title/snippet/source/optional date');

  const beforeCache = calls.length;
  await submit('寻找下一次发现');
  await expect(page.getByText('3 条结果 · 本地缓存', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(beforeCache);
  data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.history.filter((h) => h.query === '寻找下一次发现')).toHaveLength(1);
  const cacheAt = data.cache[0].at;
  await submit('寻找下一次发现');
  await expect(page.getByText('3 条结果 · 本地缓存', { exact: true })).toBeVisible();
  data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.cache[0].at).toBe(cacheAt);
  await page.getByRole('button', { name: '刷新结果', exact: true }).click();
  await expect.poll(() => calls.length).toBe(beforeCache + 1);
  await expect(page.locator('.result-card')).toHaveCount(3);
  record('Local cache avoids requests, preserves fixed TTL, and supports refresh');

  mode = 'delay';
  const second = await context.newPage();
  await second.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(second.getByRole('textbox', { name: '搜索网页', exact: true })).toBeVisible();
  const beforeShared = calls.length;
  await submit('case-shared-tabs');
  await second.getByRole('textbox', { name: '搜索网页', exact: true }).fill('case-shared-tabs');
  await second.getByRole('button', { name: '提交搜索' }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
  await expect(second.getByText('3 条结果 · 本地缓存', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(beforeShared + 1);
  await second.close();
  mode = 'success';
  record('Concurrent tabs share a request lock and reuse the completed result');

  await page.getByRole('button', { name: '切换深色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(artifacts, 'results-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'results-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'SeekTab 首页' }).click();
  await expect(page.getByRole('heading', { name: '好奇心，从这里开始。' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'home-mobile.png'), fullPage: true });
  record('Desktop and 390px responsive light/dark layouts have no horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('button', { name: '添加快捷链接', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('测试工作台');
  await page.getByLabel('网址', { exact: true }).fill('example.com/work');
  await page.getByRole('button', { name: '保存链接', exact: true }).click();
  await expect(page.getByRole('link', { name: '测 测试工作台' })).toHaveAttribute(
    'href',
    'https://example.com/work',
  );
  await page.getByRole('button', { name: '编辑 测试工作台', exact: true }).focus();
  await page.getByRole('button', { name: '编辑 测试工作台', exact: true }).click();
  await page.getByRole('button', { name: '删除链接', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑 测试工作台', exact: true })).toHaveCount(0);
  record('Quick links can be added, normalized, edited and deleted');

  for (const [apiMode, message] of [
    ['401', 'API Key 无效或已失效'],
    ['402', 'DeepSeek 账户余额不足'],
    ['500', 'DeepSeek 搜索暂时不可用'],
    ['offline', '无法连接 DeepSeek'],
    ['bad-json', '无法识别的数据'],
  ]) {
    mode = apiMode;
    await submit(`case-${apiMode}`);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('alert')).not.toContainText('RAW-PRIVATE-ERROR');
    record(`Safe error UI for ${apiMode}`);
  }
  mode = '429';
  await submit('case-rate');
  await expect(page.getByRole('alert')).toContainText('搜索请求有点频繁');
  await expect(page.getByRole('status').filter({ hasText: '服务限流' })).toBeVisible();
  await expect(page.getByRole('button', { name: /秒后重试/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重新搜索', exact: true })).toBeEnabled({
    timeout: 5000,
  });
  mode = 'success';
  await page.getByRole('button', { name: '重新搜索', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
  record('429 Retry-After countdown recovers with explicit retry');

  mode = 'empty';
  await submit('case-empty');
  await expect(page.getByRole('heading', { name: '换个角度，继续探索' })).toBeVisible();
  mode = 'unsafe';
  await submit('case-injection');
  await expect(page.locator('.result-card')).toHaveCount(1);
  await expect(page.locator('.result-card h2')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.result-card img, .result-card script')).toHaveCount(0);
  record('Empty results and unsafe provider content are handled safely');

  mode = 'delay';
  await submit('case-cancel');
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这次搜索已暂停' })).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.locator('.result-card')).toHaveCount(0);
  data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.history.some((h) => h.query === 'case-cancel')).toBe(false);
  record('Cancelled requests never paint late results or enter history');

  await submit('case-clear-during-search');
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: /清除历史（/ }).click();
  await page.getByRole('button', { name: /清除缓存（/ }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
  data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.history).toEqual([]);
  expect(data.cache).toEqual([]);
  record('Clearing private data during a request prevents late repopulation');

  mode = 'success';
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('checkbox', { name: /记住搜索历史/ }).uncheck();
  await page.getByRole('checkbox', { name: /缓存搜索结果/ }).uncheck();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await submit('case-private');
  await expect(page.locator('.result-card')).toHaveCount(3);
  data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.history).toEqual([]);
  expect(data.cache).toEqual([]);
  record('Disabling history/cache clears and suppresses local search data');

  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '移除已存密钥', exact: true }).click();
  await expect(page.getByLabel('DeepSeek API Key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.reload();
  data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.apiKey).toBe('');
  record('Key removal persists after reload');
  expect(foreignRequests).toEqual([]);
  expect(errors).toEqual([]);
  record('No remote favicon/font/analytics requests or uncaught page errors');
  await writeFile(
    path.join(artifacts, 'report.json'),
    JSON.stringify(
      {
        checks,
        passed: checks.length,
        apiRequestsMocked: calls.length,
        realApiCalls: 0,
        viewport: ['1440×1000', '390×844'],
        browser: context.browser().version(),
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} browser checks passed. Real API calls: 0.`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
