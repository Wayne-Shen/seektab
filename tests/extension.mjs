import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Runs against a real unpacked MV3 extension, with API traffic intercepted.
// A real key and billable network access are deliberately unnecessary.
const promptOf = (p) =>
  p.getByRole('combobox', { name: '搜索网页、标签页、书签和历史', exact: true });
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
      summary: '测试长摘要',
      content: '测试正文',
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
const aiStream = [
  { type: 'response.created' },
  { type: 'response.reasoning_text.delta', delta: 'SECRET-THOUGHT' },
  { type: 'response.output_text.delta', delta: 'Answer one [S1] and [S2]. Fake [S99].' },
  { type: 'response.output_text.delta', delta: '\n\nSecond [S3].' },
  { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 34 } } },
]
  .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
  .join('');
let mode = 'success';
let calls = [];
let foreignRequests = [];
let balanceCalls = 0;
let aiCalls = [];
let aiMode = 'ok';
let balanceFailure = false;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route('https://api.deepseek.com/**', async (route) => {
    const request = route.request();
    if (request.url() === 'https://api.deepseek.com/user/balance') {
      balanceCalls++;
      if (balanceFailure) return route.fulfill({ status: 500, body: 'RAW-PRIVATE-BALANCE-ERROR' });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
      });
    }
    if (request.url() === 'https://api.deepseek.com/responses') {
      aiCalls.push({
        data: request.postDataJSON(),
        authorization: request.headers().authorization,
      });
      if (aiMode === 'delay') await new Promise((r) => setTimeout(r, 1500));
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: aiStream });
    }
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
    if (
      /^https?:/.test(req.url()) &&
      !req.url().startsWith('https://api.deepseek.com/') &&
      !new URL(req.url()).hostname.endsWith('.seektab.test')
    )
      foreignRequests.push(req.url());
  });
  await context.route('https://*.seektab.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Omega Workspace</title><p>fixture</p>',
    }),
  );
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(promptOf(page)).toHaveValue('');
  await expect(
    page.locator('.hero, .quick-section, .recent-section, .page-footer, .search-aside'),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByText('添加 API Key', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'home-light.png') });
  record('Unpacked MV3 loads with local assets and first-run onboarding');

  // Check Chrome's actual new-tab override in this isolated profile.
  const newtab = await context.newPage();
  await newtab.goto('chrome://newtab');
  await expect(newtab.getByRole('button', { name: 'SeekTab 首页' })).toBeVisible();
  await newtab.close();
  record('chrome://newtab is overridden by SeekTab');

  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('combobox', { name: /主题/ }).selectOption('dark');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(artifacts, 'home-dark.png') });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('combobox', { name: /主题/ }).selectOption('light');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
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
  await expect(page.getByText('添加 API Key', { exact: true })).toHaveCount(0);
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
  await expect(promptOf(page)).toBeFocused();
  record('Settings stay usable at 320px; native modal Escape and search shortcut work');

  await page.evaluate(async () => {
    await chrome.bookmarks.create({
      title: 'Command Bookmark Alpha',
      url: 'https://bookmark.seektab.test/alpha',
    });
    await chrome.history.addUrl({ url: 'https://history.seektab.test/zeta' });
  });
  const work = await context.newPage();
  await work.goto('https://tab.seektab.test/omega');
  await page.bringToFront();
  await promptOf(page).fill('Alpha');
  await expect(page.getByRole('option', { name: /Command Bookmark Alpha/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /搜索网页「Alpha」/ })).toBeVisible();
  await promptOf(page).fill('zeta');
  await expect(page.getByRole('option', { name: /history\.seektab\.test\/zeta/ })).toBeVisible();
  await promptOf(page).fill('Omega');
  await expect(page.getByRole('option', { name: /Omega Workspace/ }).first()).toBeVisible();
  await promptOf(page).press('Tab');
  await expect(page.getByRole('button', { name: '标签页', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('option', { name: /搜索网页/ })).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'command-palette.png') });
  await promptOf(page).press('Enter');
  await expect
    .poll(() =>
      page.evaluate(async () => (await chrome.tabs.query({ active: true })).map((t) => t.title)),
    )
    .toContain('Omega Workspace');
  await page.bringToFront();
  await promptOf(page).fill('');
  await promptOf(page).fill('nothing-matches-xyz');
  await page.getByRole('button', { name: '标签页', exact: true }).click();
  await expect(page.getByText(/在标签页中没有结果/)).toBeVisible();
  await page.getByRole('button', { name: '搜索全部' }).click();
  await promptOf(page).fill('');
  await work.close();
  expect(calls).toHaveLength(1);
  record('Command palette finds tabs, bookmarks and Chrome history locally and switches tabs');

  const submit = async (q) => {
    await promptOf(page).click();
    await promptOf(page).press('ControlOrMeta+A');
    await promptOf(page).pressSequentially(q);
    await promptOf(page).press('Enter');
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
  await expect(promptOf(second)).toBeVisible();
  const beforeShared = calls.length;
  const ledgerBefore = await page.evaluate(
    async () => (await chrome.storage.local.get('seektab-usage-v1'))['seektab-usage-v1'],
  );
  const sumUsage = (ledger) =>
    ledger.days.reduce((sum, d) => sum + d.results + d.empty + d.failed + d.cancelled, 0);
  await submit('case-shared-tabs');
  await promptOf(second).fill('case-shared-tabs');
  await promptOf(second).press('Enter');
  await expect(page.locator('.result-card')).toHaveCount(3);
  await expect(second.getByText('3 条结果 · 本地缓存', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(beforeShared + 1);
  const ledgerAfter = await page.evaluate(
    async () => (await chrome.storage.local.get('seektab-usage-v1'))['seektab-usage-v1'],
  );
  expect(sumUsage(ledgerAfter) - sumUsage(ledgerBefore)).toBe(1);
  await second.close();
  mode = 'success';
  record('Concurrent tabs share a request lock and reuse the completed result');

  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('combobox', { name: /主题/ }).selectOption('dark');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(artifacts, 'results-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'results-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'SeekTab 首页' }).click();
  await expect(promptOf(page)).toHaveValue('');
  await expect(
    page.locator('.hero, .quick-section, .recent-section, .page-footer, .search-aside'),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, 'home-mobile.png'), fullPage: true });
  record('Desktop and 390px responsive light/dark layouts have no horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('button', { name: '打开设置' }).click();
  const settingsBeforeShortcut = await page.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings,
  );
  await page.getByRole('combobox', { name: /每次返回/ }).selectOption('20');
  await page.getByRole('button', { name: '添加快捷链接', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('测试工作台');
  await page.getByLabel('网址', { exact: true }).fill('example.com/work');
  await page.getByRole('button', { name: '保存链接', exact: true }).click();
  await expect(page.getByRole('link', { name: '测试工作台', exact: true })).toHaveAttribute(
    'href',
    'https://example.com/work',
  );
  await page.getByRole('button', { name: '编辑 测试工作台', exact: true }).focus();
  await page.getByRole('button', { name: '编辑 测试工作台', exact: true }).click();
  await page.getByRole('button', { name: '删除链接', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑 测试工作台', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /每次返回/ })).toHaveValue('20');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  expect(
    await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings),
  ).toEqual(settingsBeforeShortcut);
  record(
    'Settings retain unsaved drafts through shortcut editing; shortcuts remain editable without changing saved preferences',
  );

  const beforeReload = await page.evaluate(() => chrome.storage.local.get(null));
  await page.reload();
  expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual(beforeReload);
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toBeVisible();
  await expect(page.getByLabel('DeepSeek API Key', { exact: true })).toHaveValue(
    'test-only-not-a-real-key',
  );
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '搜索历史', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button').filter({ hasText: '寻找下一次发现' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  record(
    'Reload preserves the complete saved state; history and existing shortcuts remain accessible',
  );

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
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeEnabled({
    timeout: 5000,
  });
  mode = 'success';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
  record('429 Retry-After countdown recovers with explicit retry');

  mode = 'empty';
  await submit('case-empty');
  await expect(page.getByRole('heading', { name: '无结果' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '搜索已取消' })).toBeVisible();
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
  await expect.poll(() => calls.at(-1)?.data.query).toBe('case-private');
  await expect(page.locator('.result-card')).toHaveCount(3);
  data = await page.evaluate(() => chrome.storage.local.get(null));
  expect(data.history).toEqual([]);
  expect(data.cache).toEqual([]);
  record('Disabling history/cache clears and suppresses local search data');

  await submit('ai-question');
  await expect(page.locator('.result-card')).toHaveCount(3);
  expect(aiCalls).toHaveLength(0);
  await page.getByRole('button', { name: 'AI 总结' }).click();
  await expect(page.getByRole('dialog')).toContainText('API 费用');
  expect(aiCalls).toHaveLength(0);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const aiPanel = page.getByRole('region', { name: 'AI 回答' });
  await expect(aiPanel).toContainText('Answer one');
  await expect(aiPanel.locator('a.cite')).toHaveCount(3);
  await expect(aiPanel.locator('a.cite').first()).toHaveAttribute(
    'href',
    'https://example.com/discover',
  );
  await expect(aiPanel).toContainText('输入 12 / 输出 34 tokens');
  await expect(aiPanel).not.toContainText('SECRET-THOUGHT');
  await expect(aiPanel).not.toContainText('[S99]');
  expect(aiCalls).toHaveLength(1);
  expect(aiCalls[0].authorization).toBe('Bearer test-only-not-a-real-key');
  expect(aiCalls[0].data).toMatchObject({
    model: 'deepseek-flash',
    stream: true,
    max_output_tokens: 4000,
  });
  expect(aiCalls[0].data.input).toContain('<sources>');
  expect(aiCalls[0].data.input).toContain('探索开放网络，发现新的可能');
  expect(JSON.stringify(aiCalls[0].data)).not.toContain('test-only-not-a-real-key');
  let aiData = await page.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(aiData)).not.toContain('Answer one');
  expect(aiData['seektab-ai-usage-v1'].days[0]).toMatchObject({
    requests: 1,
    inputTokens: 12,
    outputTokens: 34,
  });
  await page.screenshot({ path: path.join(artifacts, 'ai-answer.png'), fullPage: true });
  await promptOf(page).fill('ai-palette');
  await expect(page.getByRole('option', { name: /向 AI 提问「ai-palette」/ })).toBeVisible();
  expect(aiCalls).toHaveLength(1);
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await promptOf(page).press('Enter');
  await expect.poll(() => aiCalls.length).toBe(2);
  await expect(page.getByRole('region', { name: 'AI 回答' })).toContainText('Answer one');
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, aiDailyCap: 2 } });
  });
  await page.getByRole('button', { name: '重新生成' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '今日 AI 请求上限' })).toBeVisible();
  expect(aiCalls).toHaveLength(2);
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, aiDailyCap: 0 } });
  });
  aiMode = 'delay';
  await page.getByRole('button', { name: '重新生成' }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await page.getByRole('button', { name: '停止生成' }).click();
  await page.waitForTimeout(1800);
  await expect(page.getByRole('region', { name: 'AI 回答' }).locator('a.cite')).toHaveCount(0);
  aiMode = 'ok';
  record(
    'AI answers run only on request, cite real sources, stay out of storage, honour the daily cap, and can be stopped',
  );

  await expect(page.locator('.rail-links .link-icon img').first()).toHaveAttribute(
    'src',
    /\/_favicon\/\?pageUrl=/,
  );
  await page.getByRole('button', { name: '重置搜索' }).click();
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'AI 回答' })).toHaveCount(0);
  await expect(promptOf(page)).toHaveValue('');
  await expect(page.getByRole('button', { name: '重置搜索' })).toHaveCount(0);
  record(
    'Reset clears the current search, results and AI answer; shortcut icons use the local favicon cache',
  );

  await submit('sort-check');
  await expect(page.locator('.result-card')).toHaveCount(3);
  const firstTitle = () => page.locator('.result-card h2').first().innerText();
  expect(await firstTitle()).toContain('探索开放网络');
  await page.getByRole('button', { name: '按日期' }).click();
  await expect(page.getByRole('button', { name: '按日期' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.result-card h2').last()).toContainText('把好奇心变成下一次行动');
  await page.reload();
  await submit('sort-check');
  await expect(page.locator('.result-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '按日期' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '按相关度' }).click();
  expect(await firstTitle()).toContain('探索开放网络');
  record('Results can be sorted by relevance or date without a new request; the choice persists');

  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('checkbox', { name: /缓存搜索结果/ }).check();
  await page.getByText('高级搜索筛选', { exact: true }).click();
  await page.getByLabel('限定站点', { exact: true }).fill('example.com');
  await page.getByLabel('本地化 IPv4（可选）', { exact: true }).fill('203.0.113.4');
  await page.getByRole('checkbox', { name: /获取网页正文/ }).check();
  await page.getByRole('checkbox', { name: /显示长摘要/ }).check();
  await page.getByRole('checkbox', { name: /显示评分/ }).check();
  await page.getByRole('button', { name: '保存设置' }).click();
  await submit('advanced');
  await expect.poll(() => calls.at(-1)?.data.query).toBe('advanced site:example.com');
  await expect(page.locator('.result-card')).toHaveCount(3);
  expect(calls.at(-1).data).toEqual({
    query: 'advanced site:example.com',
    count: 10,
    need_content: true,
    localization: '203.0.113.4',
    ori_question: 'advanced',
  });
  await expect(page.getByText('排序 2.2/3 · 权威性 2/4')).toBeVisible();
  await page.getByText('网页正文（最多显示 12,000 字符）').first().click();
  await expect(page.getByText('测试正文')).toBeVisible();
  const advancedState = await page.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(advancedState.cache)).not.toContain('测试正文');
  expect(advancedState.cache.some((entry) => entry.query.includes('advanced'))).toBe(false);
  record('Advanced filters and request options use provider fields without caching page content');

  await page.getByRole('button', { name: 'API 用量与余额' }).click();
  await expect(page.getByText('尚未刷新')).toBeVisible();
  expect(balanceCalls).toBe(0);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('CNY 12.50')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect
    .poll(() => page.locator('dialog').evaluate((d) => d.scrollWidth <= d.clientWidth))
    .toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'billing-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByText(/数据截止：/)).toBeVisible();
  expect(balanceCalls).toBe(1);
  const firstReport = await page.evaluate(
    async () => (await chrome.storage.local.get('seektab-report-v1'))['seektab-report-v1'],
  );
  expect(firstReport.days.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await submit('billing-snapshot');
  await expect.poll(() => calls.at(-1)?.data.query).toContain('billing-snapshot');
  await expect(page.locator('.result-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'API 用量与余额' }).click();
  expect(balanceCalls).toBe(1);
  expect(
    await page.evaluate(
      async () => (await chrome.storage.local.get('seektab-report-v1'))['seektab-report-v1'],
    ),
  ).toEqual(firstReport);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect.poll(() => balanceCalls).toBe(2);
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            async () => (await chrome.storage.local.get('seektab-report-v1'))['seektab-report-v1'],
          )
        ).refreshedAt,
    )
    .toBeGreaterThan(firstReport.refreshedAt);
  const refreshed = await page.evaluate(
    async () => (await chrome.storage.local.get('seektab-report-v1'))['seektab-report-v1'],
  );
  expect(refreshed.days[0].results).toBeGreaterThan(firstReport.days[0].results);
  expect(JSON.stringify(refreshed)).not.toContain('billing-snapshot');
  balanceFailure = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('余额查询失败（HTTP 500）。')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('RAW-PRIVATE-BALANCE-ERROR');
  expect(balanceCalls).toBe(3);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  record(
    'Balance and request report are frozen until explicit refresh and never include search text',
  );

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换到浅色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换到深色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换语言' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Search the web, tabs, bookmarks and history' }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'home-english-dark.png') });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('combobox', { name: /Language/ })).toHaveValue('en');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page
    .getByRole('button', { name: '切换语言' })
    .or(page.getByRole('button', { name: 'Switch language' }))
    .click();
  await expect(page.getByRole('button', { name: '切换到深色模式' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  record('Dark/light and Chinese/English switches apply immediately and persist after reload');

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
} catch (error) {
  const failedPage = context?.pages().find((page) => page.url().startsWith('chrome-extension:'));
  await failedPage
    ?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
