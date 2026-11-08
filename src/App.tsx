import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  BarChart3,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  History,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Languages,
  RotateCcw,
  Moon,
  Search,
  Settings2,
  Sparkles,
  Sun,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { safeUrl, SearchError, sortResults, validateQuery } from './lib/api';
import { getLocale, normalizeLocale, setLocale, t } from './lib/i18n';
import {
  clearData,
  initialize,
  readState,
  removeApiKey,
  savePreferences,
  setPreference,
  updateState,
} from './lib/store';
import {
  askAi,
  buildSources,
  readAiUsage,
  splitCitations,
  type AiAnswer,
  type AiSource,
} from './lib/ai';
import { runSearch, testConnection, type SearchResponse } from './lib/search';
import {
  ACCENTS,
  AI_MODELS,
  AI_TOKEN_CHOICES,
  type LocalState,
  type QuickLink,
  type SearchResult,
  type Settings,
} from './lib/types';
import { version } from '../public/manifest.json';
import {
  activateTab,
  display,
  enabledSources,
  matches,
  searchBrowser,
  type BrowserItem,
  type SourceId,
} from './lib/browser';
import { readBillingReport, refreshBillingReport, type BillingReport } from './lib/billing';

function Mark({ small = false }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className={small ? 'mark small' : 'mark'} aria-hidden="true">
      <path
        d="M12 29C9 18 20 8 37 10c1 17-10 28-21 25 7-2 13-8 17-17-9 4-15 10-17 17Z"
        fill="currentColor"
      />
      <path d="M12 37 29 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('关闭弹窗')}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
function BillingModal({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<BillingReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiDays, setAiDays] = useState<Awaited<ReturnType<typeof readAiUsage>>>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    readAiUsage()
      .then((days) => {
        if (active) setAiDays(days);
      })
      .catch(() => {});
    readBillingReport()
      .then((value) => {
        if (active) setReport(value);
      })
      .catch(() => {
        if (active) setError(t('无法读取本地报表。'));
      });
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);
  async function refresh() {
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setError('');
    try {
      const next = await refreshBillingReport(abort.signal);
      if (!abort.signal.aborted) setReport(next);
    } catch {
      if (!abort.signal.aborted) setError(t('刷新失败，请检查本地存储后重试。'));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  const days = report?.days ?? [];
  const totals = days.reduce(
    (a, day) => ({
      results: a.results + day.results,
      empty: a.empty + day.empty,
      failed: a.failed + day.failed,
      cancelled: a.cancelled + day.cancelled,
    }),
    { results: 0, empty: 0, failed: 0, cancelled: 0 },
  );
  const max = Math.max(
    1,
    ...days.slice(0, 30).map((d) => d.results + d.empty + d.failed + d.cancelled),
  );
  const fmt = (at: number) =>
    new Date(at).toLocaleString(dateLocale(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
  return (
    <Modal title={t('API 用量与余额')} onClose={onClose} wide>
      <div className="billing-report" aria-busy={busy}>
        <div className="billing-toolbar">
          <span>
            {report ? t('数据截止：{time}', { time: fmt(report.refreshedAt) }) : t('尚未刷新')}
          </span>
          <button
            className="button primary"
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <BarChart3 size={16} />}{' '}
            {busy ? t('刷新中…') : t('刷新')}
          </button>
        </div>
        <p className="field-help">
          {t(
            '仅点击刷新时查询余额并更新报表。统计只覆盖此扩展在本机完成的 Search 请求，包含连接测试及使用过的所有 API Key；不包含缓存命中、进行中的请求和其他应用的请求。',
          )}
        </p>
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        {report && (
          <>
            <section className="billing-section">
              <h3>{t('账户余额')}</h3>
              {report.balance ? (
                <>
                  {report.balance.length ? (
                    report.balance.map((row) => (
                      <div className="balance-row" key={row.currency}>
                        <strong>
                          {row.currency} {row.total}
                        </strong>
                        <span>
                          {t('赠送 {granted} · 充值 {toppedUp}', {
                            granted: row.granted,
                            toppedUp: row.toppedUp,
                          })}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>{t('没有可显示的余额。')}</p>
                  )}
                  <p className="tiny muted">
                    {t('余额查询时间：{time}；关联刷新时使用的 API Key。', {
                      time: report.balanceAt ? fmt(report.balanceAt) : t('未知'),
                    })}
                  </p>
                </>
              ) : (
                <p role="status">{report.balanceError || t('余额不可用。')}</p>
              )}
            </section>
            <section className="billing-section">
              <h3>{t('本机请求报表')}</h3>
              <p className="tiny muted">
                {report.trackingSince
                  ? t('记录起点：{time}', { time: fmt(report.trackingSince) })
                  : t('尚无记录；安装此功能之后的请求才会被统计。')}{' '}
                {t(
                  '按设备本地日期分组，最多保留最近 366 个有请求的日期。扩展关闭或本地存储不可用可能导致记录不完整；统计并非 DeepSeek 官方账单。',
                )}
              </p>
              <div className="billing-totals">
                <span>
                  {t('已完成')}{' '}
                  <strong>
                    {totals.results + totals.empty + totals.failed + totals.cancelled}
                  </strong>
                </span>
                <span>
                  {t('有结果')} <strong>{totals.results}</strong>
                </span>
                <span>
                  {t('空结果')} <strong>{totals.empty}</strong>
                </span>
                <span>
                  {t('失败')} <strong>{totals.failed}</strong>
                </span>
                <span>
                  {t('取消')} <strong>{totals.cancelled}</strong>
                </span>
              </div>
              <p className="tiny muted">
                {t('有结果不等于确认已计费；取消、网络中断或响应异常时，以服务商账单为准。')}
              </p>
              {days.length > 0 && (
                <div className="billing-scroll">
                  <table>
                    <caption>{t('最近 30 个有请求的日期')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('日期')}</th>
                        <th scope="col">{t('请求量')}</th>
                        <th scope="col">{t('有结果')}</th>
                        <th scope="col">{t('空结果')}</th>
                        <th scope="col">{t('失败')}</th>
                        <th scope="col">{t('取消')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.slice(0, 30).map((d) => {
                        const count = d.results + d.empty + d.failed + d.cancelled;
                        return (
                          <tr key={d.day}>
                            <th scope="row">{d.day}</th>
                            <td>
                              <span
                                className="usage-bar"
                                aria-hidden="true"
                                style={{ width: `${Math.round((count / max) * 72)}px` }}
                              />
                              {count}
                            </td>
                            <td>{d.results}</td>
                            <td>{d.empty}</td>
                            <td>{d.failed}</td>
                            <td>{d.cancelled}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        {aiDays.length > 0 && (
          <section className="billing-section">
            <h3>{t('AI 回答')}</h3>
            <p className="tiny muted">
              {t('本机记录：请求 {r} 次，输入 {i} / 输出 {o} tokens（不含问题内容）。', {
                r: aiDays.reduce((a, d) => a + d.requests, 0),
                i: aiDays.reduce((a, d) => a + d.inputTokens, 0),
                o: aiDays.reduce((a, d) => a + d.outputTokens, 0),
              })}
            </p>
          </section>
        )}
        <p className="field-help">
          <a href="https://platform.deepseek.com/usage" target="_blank" rel="noopener noreferrer">
            {t('查看 DeepSeek 平台完整用量与账单')} <ArrowUpRight size={14} />
          </a>
        </p>
      </div>
    </Modal>
  );
}
function SettingsModal({
  state,
  onClose,
  onSaved,
  cooldown,
}: {
  state: LocalState;
  onClose: () => void;
  onSaved: (message: string) => void;
  cooldown: number;
}) {
  const [linkEditor, setLinkEditor] = useState<{ link?: QuickLink } | null>(null);
  const [draft, setDraft] = useState<Settings>({ ...state.settings });
  const [key, setKey] = useState(state.apiKey);
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [dataFeedback, setDataFeedback] = useState('');
  const testAbort = useRef<AbortController | null>(null);
  useEffect(() => () => testAbort.current?.abort(), []);
  function patch(value: Partial<Settings>) {
    setDraft((s) => ({ ...s, ...value }));
  }
  async function test() {
    setFeedback(null);
    if (!key.trim() || key.trim().length > 512 || /\s/.test(key.trim())) {
      setFeedback({ text: t('请填写有效的 API Key，仅粘贴密钥本身。'), ok: false });
      return;
    }
    setTesting(true);
    const abort = new AbortController();
    testAbort.current = abort;
    try {
      const ms = await testConnection(key, abort.signal);
      if (!abort.signal.aborted)
        setFeedback({ text: t('连接成功 · 搜索接口可用 · {ms} ms', { ms }), ok: true });
    } catch (e) {
      if (!abort.signal.aborted)
        setFeedback({
          text: e instanceof SearchError ? e.message : t('测试失败，请检查本地存储和网络后重试。'),
          ok: false,
        });
    } finally {
      if (!abort.signal.aborted) setTesting(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await savePreferences(draft, key);
      onSaved(t('设置已保存在本机'));
      onClose();
    } catch (e) {
      setFeedback({ text: e instanceof Error ? e.message : t('保存失败，请重试。'), ok: false });
    } finally {
      setSaving(false);
    }
  }
  async function clear(kind: 'history' | 'cache') {
    try {
      await clearData(kind);
      setDataFeedback(kind === 'history' ? t('搜索历史已清除') : t('搜索缓存已清除'));
    } catch {
      setDataFeedback(t('清除失败，请重试'));
    }
  }
  return (
    <>
      <Modal title={t('设置')} onClose={onClose} wide>
        <form onSubmit={save}>
          <section className="settings-section">
            <div className="section-label">
              <LockKeyhole size={17} />
              <h3>{t('连接 DeepSeek')}</h3>
            </div>
            <label className="field-label" htmlFor="api-key">
              DeepSeek API Key
            </label>
            <div className="key-input">
              <input
                autoComplete="off"
                spellCheck={false}
                id="api-key"
                name="api-key"
                type={visible ? 'text' : 'password'}
                placeholder={t('粘贴你的 API Key')}
                value={key}
                maxLength={512}
                onChange={(e) => {
                  setKey(e.target.value);
                  setFeedback(null);
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={visible ? t('隐藏密钥') : t('显示密钥')}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p className="field-help">
              {t('密钥存于 Chrome 本地存储，不会同步。具有本机访问权限的人可能读取它。')}
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('获取密钥')} <ExternalLink size={12} />
              </a>
            </p>
            <div className="connection-actions">
              <button
                className="button secondary"
                type="button"
                onClick={test}
                disabled={testing || saving || !key.trim() || cooldown > 0}
              >
                {testing ? <LoaderCircle size={15} className="spin" /> : <Globe2 size={15} />}{' '}
                {testing
                  ? t('正在测试…')
                  : cooldown > 0
                    ? t('请等待 {n} 秒', { n: cooldown })
                    : t('测试连接')}
              </button>
              {state.apiKey && (
                <button
                  className="text-button danger"
                  type="button"
                  disabled={testing || saving}
                  onClick={async () => {
                    try {
                      await removeApiKey();
                      setKey('');
                      setFeedback({ text: t('已移除本机保存的密钥'), ok: true });
                    } catch {
                      setFeedback({ text: t('移除失败，请重试。'), ok: false });
                    }
                  }}
                >
                  {t('移除已存密钥')}
                </button>
              )}
            </div>
            <p className="tiny muted">
              {t(
                '测试会向 DeepSeek 发送一次「DeepSeek」搜索，可能产生 API 费用；不会写入历史或缓存。',
              )}
            </p>
            {feedback && (
              <p className={`feedback ${feedback.ok ? 'success' : 'error'}`} role="status">
                {feedback.ok ? <CheckCircle2 size={16} /> : <Globe2 size={16} />} {feedback.text}
              </p>
            )}
          </section>
          <section className="settings-section">
            <div className="section-label">
              <SlidersHorizontal size={17} />
              <h3>{t('外观与搜索')}</h3>
            </div>
            <div className="settings-grid">
              <label className="field-label">
                {t('主题')}
                <select
                  value={draft.theme}
                  onChange={(e) => patch({ theme: e.target.value as Settings['theme'] })}
                >
                  <option value="system">{t('跟随系统')}</option>
                  <option value="light">{t('浅色')}</option>
                  <option value="dark">{t('深色')}</option>
                </select>
              </label>
              <label className="field-label">
                {t('每次返回')}
                <select
                  value={draft.count}
                  onChange={(e) => patch({ count: Number(e.target.value) })}
                >
                  {Array.from({ length: 50 }, (_, i) => i + 1).map((count) => (
                    <option key={count} value={count}>
                      {t('{n} 条结果', { n: count })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="settings-grid">
              <label className="field-label">
                {t('界面语言')}
                <select
                  value={draft.locale}
                  onChange={(e) => patch({ locale: e.target.value as Settings['locale'] })}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="field-label">
                {t('强调色')}
                <select
                  value={draft.accent}
                  onChange={(e) => patch({ accent: e.target.value as Settings['accent'] })}
                >
                  {ACCENTS.map((a) => (
                    <option key={a} value={a}>
                      {accentLabel(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                {t('时钟')}
                <select
                  value={draft.clock12 ? '12' : '24'}
                  onChange={(e) => patch({ clock12: e.target.value === '12' })}
                >
                  <option value="24">{t('24 小时制')}</option>
                  <option value="12">{t('12 小时制')}</option>
                </select>
              </label>
            </div>
            <Toggle
              label={t('搜索已打开的标签页')}
              description={t('输入时在本机匹配所有窗口的标签页标题和网址。')}
              checked={draft.searchTabs}
              onChange={(searchTabs) => patch({ searchTabs })}
            />
            <Toggle
              label={t('搜索书签')}
              description={t('输入时在本机查询 Chrome 书签。')}
              checked={draft.searchBookmarks}
              onChange={(searchBookmarks) => patch({ searchBookmarks })}
            />
            <Toggle
              label={t('搜索 Chrome 浏览历史')}
              description={t('输入时在本机查询浏览历史；不会上传，也不会被保存到 SeekTab。')}
              checked={draft.searchHistory}
              onChange={(searchHistory) => patch({ searchHistory })}
            />
            <details className="advanced-settings">
              <summary>{t('高级搜索筛选')}</summary>
              <p className="field-help">
                {t('筛选会附加到每次搜索；搜索词与筛选合计最多 128 个字符。')}
              </p>
              <div className="settings-grid">
                {(
                  [
                    ['site', t('限定站点'), t('多个域名用空格分隔')],
                    ['excludeSite', t('排除站点'), t('多个域名用空格分隔')],
                    ['language', t('语言代码'), t('例如 zh,en')],
                    ['exactPhrase', t('精确短语'), ''],
                    ['excludeTerms', t('排除关键词'), t('用空格分隔')],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <label key={field} className="field-label">
                    {label}
                    <input
                      type="text"
                      value={draft[field]}
                      placeholder={placeholder}
                      onChange={(e) => patch({ [field]: e.target.value })}
                    />
                  </label>
                ))}
                {(
                  [
                    ['after', t('发布于此日期之后')],
                    ['before', t('发布于此日期之前')],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="field-label">
                    {label}
                    <input
                      type="date"
                      value={draft[field]}
                      onChange={(e) => patch({ [field]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <label className="field-label">
                {t('本地化 IPv4（可选）')}
                <input
                  value={draft.localization}
                  placeholder={t('留空不发送')}
                  onChange={(e) => patch({ localization: e.target.value })}
                />
              </label>
              <p className="field-help">
                {t('填写后此地址会随搜索发送给 DeepSeek。仅在需要本地化结果时输入。')}
              </p>
              <Toggle
                label={t('获取网页正文')}
                description={t('请求正文可能增加响应体积；正文仅在当前页面显示，不写入缓存。')}
                checked={draft.needContent}
                onChange={(needContent) => patch({ needContent })}
              />
              <Toggle
                label={t('显示长摘要')}
                description={t('显示 DeepSeek 返回的长摘要。')}
                checked={draft.showSummary}
                onChange={(showSummary) => patch({ showSummary })}
              />
              <Toggle
                label={t('显示评分')}
                description={t('显示 DeepSeek 的排序分数和权威性评级；这些不是事实核验。')}
                checked={draft.showScores}
                onChange={(showScores) => patch({ showScores })}
              />
            </details>
            <Toggle
              label={t('在新标签页打开链接')}
              description={t('保留当前搜索结果，继续探索。')}
              checked={draft.openNewTab}
              onChange={(openNewTab) => patch({ openNewTab })}
            />
          </section>
          <section className="settings-section">
            <div className="section-label">
              <Sparkles size={17} />
              <h3>{t('AI 回答')}</h3>
            </div>
            <Toggle
              label={t('启用 AI 回答')}
              description={t('仅在你点击 AI 时调用模型；输入和打开页面不会调用。')}
              checked={draft.aiEnabled}
              onChange={(aiEnabled) => patch({ aiEnabled })}
            />
            <div className="settings-grid">
              <label className="field-label">
                {t('模型')}
                <select
                  value={draft.aiModel}
                  onChange={(e) => patch({ aiModel: e.target.value as Settings['aiModel'] })}
                >
                  {AI_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                {t('使用的搜索结果数')}
                <select
                  value={draft.aiSources}
                  onChange={(e) => patch({ aiSources: Number(e.target.value) })}
                >
                  {Array.from({ length: 8 }, (_, i) => i + 3).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                {t('回答长度上限')}
                <select
                  value={draft.aiMaxTokens}
                  onChange={(e) => patch({ aiMaxTokens: Number(e.target.value) })}
                >
                  {AI_TOKEN_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n} tokens
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                {t('每日 AI 请求上限（0 为不限）')}
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={draft.aiDailyCap}
                  onChange={(e) =>
                    patch({
                      aiDailyCap: Math.min(
                        1000,
                        Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <p className="field-help">
              {t('这是本机的预算限制，不是 DeepSeek 的官方额度。AI 回答可能产生 API 费用。')}
            </p>
          </section>
          <section className="settings-section">
            <div className="section-label">
              <ShieldCheck size={17} />
              <h3>{t('本地数据')}</h3>
            </div>
            <Toggle
              label={t('记住搜索历史')}
              description={t('保存最近 50 条成功搜索，关闭会清除历史。')}
              checked={draft.historyEnabled}
              onChange={(historyEnabled) => patch({ historyEnabled })}
            />
            <Toggle
              label={t('缓存搜索结果')}
              description={t('15 分钟内复用相同搜索，最多保存 20 组。关闭会清除缓存。')}
              checked={draft.cacheEnabled}
              onChange={(cacheEnabled) => patch({ cacheEnabled })}
            />
            <div className="data-actions">
              <button className="text-button" type="button" onClick={() => clear('history')}>
                <Trash2 size={14} />
                {t('清除历史（{n}）', { n: state.history.length })}
              </button>
              <button className="text-button" type="button" onClick={() => clear('cache')}>
                <Trash2 size={14} />
                {t('清除缓存（{n}）', { n: state.cache.length })}
              </button>
            </div>
            {dataFeedback && (
              <p className="tiny" role="status">
                {dataFeedback}
              </p>
            )}
            <p className="privacy-note">
              {t(
                '搜索词仅在你选择「搜索网页」时直发 DeepSeek。标签页、书签和浏览历史只在本机匹配，不上传、不保存副本；无后端、无统计追踪。',
              )}
              <a
                href="https://api-docs.deepseek.com/zh-cn/guides/search/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('接口说明')} <ArrowUpRight size={12} />
              </a>
            </p>
          </section>
          <section className="settings-section" aria-labelledby="shortcuts-title">
            <div className="section-label">
              <Link2 size={17} />
              <h3 id="shortcuts-title">{t('快捷链接')}</h3>
            </div>
            <div className="saved-links">
              {state.links.map((link) => (
                <div className="saved-link" key={link.id}>
                  <a
                    href={safeUrl(link.url) || undefined}
                    target={state.settings.openNewTab ? '_blank' : '_self'}
                    rel="noopener noreferrer"
                  >
                    {link.title}
                    <ArrowUpRight size={16} />
                  </a>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('编辑 {title}', { title: link.title })}
                    onClick={() => setLinkEditor({ link })}
                  >
                    <SlidersHorizontal size={18} />
                  </button>
                </div>
              ))}
            </div>
            {state.links.length < 8 && (
              <button type="button" className="text-button" onClick={() => setLinkEditor({})}>
                <Plus size={18} />
                {t('添加快捷链接')}
              </button>
            )}
          </section>
          <footer className="modal-footer">
            <span className="tiny muted">SeekTab {version}</span>
            <button className="button primary" type="submit" disabled={saving || testing}>
              {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
              {t('保存设置')}
            </button>
          </footer>
        </form>
      </Modal>
      {linkEditor && (
        <LinkModal
          link={linkEditor.link}
          count={state.links.length}
          onClose={() => setLinkEditor(null)}
          onSaved={() => onSaved(t('快捷链接已保存'))}
        />
      )}
    </>
  );
}
function LinkModal({
  link,
  onClose,
  onSaved,
  count,
}: {
  link?: QuickLink;
  count: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(link?.title || '');
  const [url, setUrl] = useState(link?.url || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const normalized = safeUrl(
      /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`,
    );
    if (!normalized || !title.trim()) {
      setError(t('请填写名称和有效的 HTTP / HTTPS 网址。'));
      return;
    }
    if (!link && count >= 8) {
      setError(t('最多添加 8 个快捷链接。'));
      return;
    }
    setBusy(true);
    try {
      await updateState((s) => ({
        ...s,
        links: link
          ? s.links.map((l) =>
              l.id === link.id ? { ...l, title: title.trim(), url: normalized } : l,
            )
          : [...s.links, { id: crypto.randomUUID(), title: title.trim(), url: normalized }].slice(
              0,
              8,
            ),
      }));
      onSaved();
      onClose();
    } catch {
      setError(t('保存失败，请重试。'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={link ? t('编辑快捷链接') : t('添加快捷链接')} onClose={onClose}>
      <form onSubmit={submit} className="link-form">
        <label className="field-label">
          {t('名称')}
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={24}
            placeholder={t('例如：我的工作台')}
            required
          />
        </label>
        <label className="field-label">
          {t('网址')}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={2048}
            placeholder="https://example.com"
            required
          />
        </label>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          {link ? (
            <button
              type="button"
              className="text-button danger"
              disabled={busy}
              onClick={async () => {
                try {
                  await updateState((s) => ({
                    ...s,
                    links: s.links.filter((l) => l.id !== link.id),
                  }));
                  onSaved();
                  onClose();
                } catch {
                  setError(t('删除失败，请重试。'));
                }
              }}
            >
              <Trash2 size={15} />
              {t('删除链接')}
            </button>
          ) : (
            <span />
          )}
          <button className="button primary" disabled={busy} type="submit">
            {t('保存链接')} <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function HistoryModal({
  state,
  onClose,
  onSearch,
  onClear,
}: {
  state: LocalState;
  onClose: () => void;
  onSearch: (q: string) => void;
  onClear: () => void;
}) {
  return (
    <Modal title={t('搜索历史')} onClose={onClose}>
      <div className="history-list">
        {state.history.length ? (
          state.history.map((h) => (
            <button
              key={h.query}
              onClick={() => {
                onClose();
                onSearch(h.query);
              }}
            >
              <History size={16} />
              <span>{h.query}</span>
              <time>
                {new Date(h.at).toLocaleDateString(dateLocale(), {
                  month: 'short',
                  day: 'numeric',
                })}
              </time>
              <ArrowUpRight size={15} />
            </button>
          ))
        ) : (
          <div className="empty-small">
            <History size={28} />
            <p>{state.settings.historyEnabled ? t('暂无搜索历史') : t('历史记录已关闭。')}</p>
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <span className="tiny muted">{t('最多保留 50 条')}</span>
        <button className="text-button danger" onClick={onClear} disabled={!state.history.length}>
          <Trash2 size={14} />
          {t('清除全部历史')}
        </button>
      </footer>
    </Modal>
  );
}

type Scope = 'all' | 'web' | 'ai' | SourceId;
interface AiView {
  status: 'running' | 'done' | 'error';
  question: string;
  text: string;
  sources: AiSource[];
  answer?: AiAnswer;
  error?: SearchError;
}
interface PaletteRow {
  key: string;
  title: string;
  url: string;
  hint: string;
  run: () => void;
}
interface PaletteGroup {
  id: string;
  label: string;
  rows: PaletteRow[];
}
const NO_ITEMS: Record<SourceId, BrowserItem[]> = { tabs: [], bookmarks: [], history: [] };
const dateLocale = () => (getLocale() === 'en' ? 'en-GB' : 'zh-CN');
const scopeLabel = (id: Scope) =>
  ({
    all: t('全部'),
    tabs: t('标签页'),
    bookmarks: t('书签'),
    history: t('历史'),
    web: t('网页'),
    ai: 'AI',
  })[id];
const sourceHint = (id: SourceId) => (id === 'tabs' ? t('切换到标签页') : t('打开'));
const accentLabel = (a: Settings['accent']) =>
  ({ amber: t('琥珀'), sky: t('天蓝'), mint: t('薄荷'), coral: t('珊瑚') })[a];

function AiPanel({
  ai,
  linkProps,
  onStop,
  onRetry,
}: {
  ai: AiView;
  linkProps: { target: string; rel: string };
  onStop: () => void;
  onRetry: () => void;
}) {
  const running = ai.status === 'running';
  const usage = ai.answer?.usage;
  return (
    <section className="ai-panel" aria-label={t('AI 回答')} aria-busy={running}>
      <div className="ai-head">
        <h2>
          <Sparkles size={16} />
          {t('AI 回答')}
        </h2>
        <span aria-live="polite">{running ? t('生成中…') : ai.answer?.model}</span>
        {running ? (
          <button className="text-button" type="button" onClick={onStop}>
            {t('停止生成')}
          </button>
        ) : (
          <button className="text-button" type="button" onClick={onRetry}>
            {t('重新生成')}
          </button>
        )}
      </div>
      {ai.text ? (
        <div className="ai-text">
          {ai.text.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i}>
              {splitCitations(paragraph, ai.sources.length).map((part, j) =>
                'cite' in part ? (
                  <a
                    key={j}
                    className="cite"
                    href={safeUrl(ai.sources[part.cite - 1].url) || undefined}
                    title={ai.sources[part.cite - 1].title}
                    {...linkProps}
                  >
                    {part.cite}
                  </a>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )}
            </p>
          ))}
        </div>
      ) : (
        running && (
          <p className="tiny muted">
            <LoaderCircle size={14} className="spin" />{' '}
            {t('正在阅读 {n} 个搜索结果…', { n: ai.sources.length })}
          </p>
        )
      )}
      {ai.status === 'error' && ai.error && (
        <p className="feedback error" role="alert">
          {ai.error.message}
        </p>
      )}
      {ai.answer?.truncated && <p className="tiny muted">{t('回答因长度上限被截断。')}</p>}
      <p className="tiny muted">
        {t('AI 生成，可能有误，请核对来源。')}
        {ai.status === 'done' && ` · ${t('基于 {n} 个搜索结果', { n: ai.sources.length })}`}
        {usage &&
          ` · ${t('输入 {i} / 输出 {o} tokens', { i: usage.inputTokens, o: usage.outputTokens })}`}
      </p>
    </section>
  );
}

const FAVICON =
  typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('/_favicon/')
    : '';
function LinkIcon({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const letter = ([...title.trim()][0] ?? '?').toUpperCase();
  let hue = 0;
  for (const c of title) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  // Chrome serves this from its local favicon cache; no network request is made.
  const src = FAVICON ? `${FAVICON}?pageUrl=${encodeURIComponent(url)}&size=32` : '';
  return (
    <span className="link-icon" style={{ background: `hsl(${hue} 45% 38%)` }} aria-hidden="true">
      {letter}
      {src && !failed && (
        <img src={src} alt="" width={20} height={20} onError={() => setFailed(true)} />
      )}
    </span>
  );
}

export default function App() {
  const [state, setState] = useState<LocalState | null>(null);
  const [fatal, setFatal] = useState('');
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<SearchError | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'settings' | 'history' | 'billing' | null>(
    location.hash === '#settings' ? 'settings' : null,
  );
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const searchInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    let active = true;
    initialize()
      .then((s) => {
        if (active) setState(s);
      })
      .catch((e) => {
        if (active)
          setFatal(e instanceof Error ? e.message : t('无法读取本地设置，请重新加载扩展。'));
      });
    const changed = () => {
      readState()
        .then((s) => {
          if (active) setState(s);
        })
        .catch(() => {
          if (active) setToast('无法读取本地设置，请重新加载扩展');
        });
    };
    globalThis.chrome?.storage?.onChanged.addListener(changed);
    return () => {
      active = false;
      globalThis.chrome?.storage?.onChanged.removeListener(changed);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  setLocale(state?.settings.locale ?? normalizeLocale(undefined, navigator.language));
  const dark =
    state?.settings.theme === 'dark' || (state?.settings.theme !== 'light' && systemDark);
  useEffect(() => {
    if (state) {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.accent = state.settings.accent;
      document.documentElement.lang = state.settings.locale === 'en' ? 'en' : 'zh-CN';
      localStorage.setItem('seektab-accent', state.settings.accent);
      localStorage.setItem('seektab-theme', state.settings.theme);
    }
  }, [state?.settings.theme, state?.settings.accent, state?.settings.locale, dark]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modal) return;
      const target = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable;
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modal]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    document.title = searchedQuery ? `${searchedQuery} · SeekTab` : t('SeekTab · 搜索');
  }, [searchedQuery]);
  const cooldown = Math.max(0, Math.ceil(((state?.cooldownUntil || 0) - now) / 1000));
  const [scope, setScope] = useState<Scope>('all');
  const [active, setActive] = useState(0);
  const [found, setFound] = useState(NO_ITEMS);
  const [addingLink, setAddingLink] = useState(false);
  const [ai, setAi] = useState<AiView | null>(null);
  const [aiNotice, setAiNotice] = useState<{ q: string; results: SearchResult[] } | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const aiId = useRef(0);
  const trimmed = query.trim();
  const sources = state ? enabledSources(state.settings) : [];
  const sourceKey = sources.join();
  const aiOn = !!state?.settings.aiEnabled;
  const scopeNow: Scope =
    scope === 'all' || scope === 'web' || (scope === 'ai' ? aiOn : sources.includes(scope))
      ? scope
      : 'all';
  const scopes: Scope[] = ['all', ...sources, 'web', ...(aiOn ? (['ai'] as const) : [])];
  const paletteOpen = !!trimmed && trimmed !== searchedQuery;
  useEffect(() => {
    if (!trimmed || !globalThis.chrome?.tabs) {
      setFound(NO_ITEMS);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      const wanted = scopeNow === 'all' ? sources : sources.filter((id) => id === scopeNow);
      searchBrowser(trimmed, wanted).then((items) => {
        if (live) setFound(items);
      });
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [trimmed, scopeNow, sourceKey]);
  useEffect(() => setActive(0), [trimmed, scopeNow]);
  function stopAi() {
    aiId.current++;
    aiAbort.current?.abort();
  }
  async function startAi(q: string, results: SearchResult[], acknowledged = false) {
    if (!state) return;
    if (!state.settings.aiAcknowledged && !acknowledged) {
      setAiNotice({ q, results });
      return;
    }
    aiAbort.current?.abort();
    const id = ++aiId.current;
    const controller = new AbortController();
    aiAbort.current = controller;
    const sources = buildSources(results, state.settings.aiSources);
    setAi({ status: 'running', question: q, text: '', sources });
    try {
      const answer = await askAi(q, results, controller.signal, (text) => {
        if (id === aiId.current) setAi((a) => a && { ...a, text });
      });
      if (id === aiId.current)
        setAi({ status: 'done', question: q, text: answer.text, sources: answer.sources, answer });
    } catch (e) {
      if (id === aiId.current)
        setAi((a) => ({
          status: 'error',
          question: q,
          text: a?.text ?? '',
          sources,
          error:
            e instanceof SearchError
              ? e
              : new SearchError('storage', t('本地存储暂时不可用，请重新加载扩展后重试。')),
        }));
    }
  }
  async function search(value: string, refresh = false, withAi = false) {
    let q: string;
    try {
      q = validateQuery(value);
    } catch (e) {
      setError(e as SearchError);
      searchInput.current?.focus();
      return;
    }
    abortRef.current?.abort();
    stopAi();
    setAi(null);
    const id = ++requestId.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setQuery(q);
    setSearchedQuery(q);
    setResponse(null);
    setError(null);
    setBusy(true);
    try {
      const result = await runSearch(q, controller.signal, refresh);
      if (id === requestId.current && !controller.signal.aborted) {
        setResponse(result);
        if (withAi && result.results.length) void startAi(q, result.results);
      }
    } catch (e) {
      if (id === requestId.current)
        setError(
          e instanceof SearchError
            ? e
            : new SearchError(
                controller.signal.aborted ? 'cancelled' : 'storage',
                controller.signal.aborted
                  ? t('搜索已取消。')
                  : t('本地存储暂时不可用，请重新加载扩展后重试。'),
              ),
        );
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  function home() {
    stopAi();
    setAi(null);
    abortRef.current?.abort();
    requestId.current++;
    setBusy(false);
    setSearchedQuery('');
    setQuery('');
    setResponse(null);
    setError(null);
  }
  function closeModal() {
    setModal(null);
    if (location.hash) history.replaceState(null, '', location.pathname);
  }
  async function clearHistory() {
    try {
      await clearData('history');
      setToast('搜索历史已清除');
    } catch {
      setToast('清除失败，请重试');
    }
  }
  function openUrl(url: string) {
    if (!safeUrl(url)) return;
    const newTab = !!state?.settings.openNewTab;
    // Browser-initiated navigation (like typing in the address bar) carries no
    // cross-site initiator, which sites such as LuCI require.
    if (typeof chrome !== 'undefined' && chrome.tabs?.update) {
      const done = newTab ? chrome.tabs.create({ url }) : chrome.tabs.update({ url });
      Promise.resolve(done).catch(() => fallbackOpen(url, newTab));
      return;
    }
    fallbackOpen(url, newTab);
  }
  function fallbackOpen(url: string, newTab: boolean) {
    if (newTab) window.open(url, '_blank', 'noopener,noreferrer');
    else location.assign(url);
  }
  function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>, url: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openUrl(url);
  }
  const groups: PaletteGroup[] = [];
  if (paletteOpen) {
    if (scopeNow === 'all' || scopeNow === 'web')
      groups.push({
        id: 'web',
        label: t('网页'),
        rows: [
          {
            key: 'web',
            title: t('搜索网页「{query}」', { query: trimmed }),
            url: 'DeepSeek Search',
            hint: t('搜索'),
            run: () => void search(trimmed),
          },
        ],
      });
    if (aiOn && (scopeNow === 'all' || scopeNow === 'ai'))
      groups.push({
        id: 'ai',
        label: 'AI',
        rows: [
          {
            key: 'ai',
            title: t('向 AI 提问「{query}」', { query: trimmed }),
            url: t('搜索并生成带引用的回答'),
            hint: t('提问'),
            run: () => void search(trimmed, false, true),
          },
        ],
      });
    for (const id of sources) {
      if (scopeNow !== 'all' && scopeNow !== id) continue;
      const rows: PaletteRow[] = found[id].map((item) => ({
        key: item.id,
        title: item.title,
        url: display(item.url),
        hint: sourceHint(id),
        run: () => (id === 'tabs' ? void activateTab(item) : openUrl(item.url)),
      }));
      if (id === 'history' && state?.settings.historyEnabled)
        for (const h of state.history
          .filter((entry) => matches({ title: entry.query, url: '' }, trimmed))
          .slice(0, 2))
          rows.push({
            key: `saved-${h.query}`,
            title: h.query,
            url: t('SeekTab 搜索记录'),
            hint: t('再次搜索'),
            run: () => void search(h.query),
          });
      if (rows.length) groups.push({ id, label: scopeLabel(id), rows });
    }
  }
  const flat = groups.flatMap((g) => g.rows);
  const cur = Math.min(active, Math.max(flat.length - 1, 0));
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (!e.altKey || !digit || modal || !state) return;
      const link = state.links[Number(digit) - 1];
      if (!link) return;
      e.preventDefault();
      openUrl(link.url);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });
  function onPromptKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQuery(paletteOpen || !searchedQuery ? '' : searchedQuery);
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && trimmed) {
      e.preventDefault();
      setScope(scopes[(scopes.indexOf(scopeNow) + 1) % scopes.length]);
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && flat.length) {
      e.preventDefault();
      setActive((cur + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    }
  }
  if (fatal)
    return (
      <main className="fatal">
        <Mark />
        <h1>{t('在 Chrome 中打开 SeekTab')}</h1>
        <p>{fatal}</p>
      </main>
    );
  if (!state)
    return (
      <main className="boot" aria-label={t('正在加载 SeekTab')}>
        <Mark />
        <LoaderCircle className="spin" size={20} />
      </main>
    );
  const linkProps = {
    target: state.settings.openNewTab ? '_blank' : '_self',
    rel: 'noopener noreferrer',
  };
  const searching = !!searchedQuery;
  const clock = new Date(now);
  const hour12 = state.settings.clock12;
  const time = clock.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  });
  const [clockText, meridiem = ''] = hour12 ? time.split(' ') : [time];
  const resultsVisible = searching && !paletteOpen;
  let rowIndex = 0;
  return (
    <div className={`app command ${searching ? 'has-results' : ''}`}>
      <main className="command-main">
        <button className="brand" onClick={home} aria-label={t('SeekTab 首页')}>
          seektab
        </button>
        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed) return;
            if (paletteOpen) flat[cur]?.run();
            else void search(query);
          }}
        >
          <span className="prompt-glyph" aria-hidden="true">
            &gt;
          </span>
          <input
            ref={searchInput}
            role="combobox"
            aria-expanded={paletteOpen}
            aria-controls="palette"
            aria-activedescendant={paletteOpen && flat.length ? `row-${cur}` : undefined}
            aria-label={t('搜索网页、标签页、书签和历史')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onPromptKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('搜索一切')}
            maxLength={256}
          />
          {busy && (
            <button
              type="button"
              className="stop-button"
              aria-label={t('停止')}
              onClick={() => abortRef.current?.abort()}
            >
              <X size={18} />
            </button>
          )}
          {(query || searching) && !busy && (
            <button
              type="button"
              className="reset-button"
              aria-label={t('重置搜索')}
              title={t('清除当前搜索、结果和 AI 回答')}
              onClick={() => {
                home();
                searchInput.current?.focus();
              }}
            >
              <RotateCcw size={16} />
              <span>{t('重置')}</span>
            </button>
          )}
        </form>
        <div className="scopes" role="group" aria-label={t('搜索范围')}>
          {scopes.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === scopeNow}
              onClick={() => {
                setScope(id);
                searchInput.current?.focus();
              }}
            >
              {scopeLabel(id)}
            </button>
          ))}
        </div>
        {!state.apiKey && (
          <button className="setup-prompt" onClick={() => setModal('settings')}>
            {t('添加 API Key')}
          </button>
        )}
        {!searching && error && (
          <p className="feedback error" role="alert">
            {error.message}
          </p>
        )}
        <div
          id="palette"
          role="listbox"
          aria-label={t('搜索建议')}
          className="palette"
          hidden={!flat.length}
        >
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.label} className="palette-group">
              <div className="palette-label">{g.label}</div>
              {g.rows.map((row) => {
                const idx = rowIndex++;
                return (
                  <div
                    key={row.key}
                    id={`row-${idx}`}
                    role="option"
                    aria-selected={idx === cur}
                    className="palette-row"
                    onMouseEnter={() => setActive(idx)}
                    onClick={row.run}
                  >
                    <span className="row-title">{row.title}</span>
                    <span className="row-url">{row.url}</span>
                    <span className="row-hint">{idx === cur ? row.hint : ''}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {paletteOpen && !flat.length && (
          <div className="palette-empty">
            <p>
              {t('「{query}」在{scope}中没有结果', {
                query: trimmed,
                scope: scopeLabel(scopeNow),
              })}
            </p>
            <div>
              <button className="button primary" type="button" onClick={() => setScope('web')}>
                {t('搜索网页')}
              </button>
              <button className="button secondary" type="button" onClick={() => setScope('all')}>
                {t('搜索全部')}
              </button>
            </div>
          </div>
        )}
        {!searching && !paletteOpen && (
          <div className="key-hints" aria-hidden="true">
            <span>{t('↑↓ 移动')}</span>
            <span>{t('⏎ 打开')}</span>
            <span>{t('tab 切换范围')}</span>
            <span>{t('esc 清除')}</span>
          </div>
        )}
        {resultsVisible && (
          <div className="results-layout">
            <section className="results-column" aria-label={t('搜索结果')} aria-busy={busy}>
              <div className="results-heading">
                <h1>
                  <Globe2 size={16} />
                  {t('网页结果')}
                </h1>
                <span aria-live="polite">
                  {busy
                    ? t('搜索中…')
                    : response
                      ? `${t('{n} 条结果', { n: response.results.length })}${response.fromCache ? t(' · 本地缓存') : ''}`
                      : 'DeepSeek Search'}
                </span>
                {aiOn && response && response.results.length > 0 && !ai && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void startAi(searchedQuery, response.results)}
                    title={t('用搜索结果生成带引用的 AI 回答')}
                  >
                    <Sparkles size={14} />
                    {t('AI 总结')}
                  </button>
                )}
                {response && (
                  <button
                    className="text-button"
                    disabled={cooldown > 0}
                    onClick={() => void search(searchedQuery, true)}
                    title={t('忽略缓存，重新请求搜索')}
                  >
                    {t('刷新结果')}
                  </button>
                )}
              </div>
              {response && response.results.length > 1 && (
                <div className="scopes sort-bar" role="group" aria-label={t('排序')}>
                  {(['relevance', 'date'] as const).map((by) => (
                    <button
                      key={by}
                      type="button"
                      aria-pressed={state.settings.sortBy === by}
                      onClick={() =>
                        void setPreference({ sortBy: by }).catch(() =>
                          setToast(t('保存失败，请重试。')),
                        )
                      }
                    >
                      {by === 'relevance' ? t('按相关度') : t('按日期')}
                    </button>
                  ))}
                </div>
              )}
              {cooldown > 0 && (
                <div className="rate-notice" role="status">
                  <Clock3 size={16} />
                  <span>
                    {t('服务限流，请在 {n} 秒后重试。缓存结果仍可使用。', { n: cooldown })}
                  </span>
                </div>
              )}
              {ai && response && (
                <AiPanel
                  ai={ai}
                  linkProps={linkProps}
                  onStop={stopAi}
                  onRetry={() => void startAi(searchedQuery, response.results)}
                />
              )}
              {busy && (
                <div className="loading-results" role="status">
                  <p>
                    <LoaderCircle size={16} className="spin" />
                    {t('正在搜索「{query}」', { query: searchedQuery })}
                  </p>
                  {[1, 2, 3].map((n) => (
                    <div className="skeleton" key={n}>
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              )}
              {!busy && error && (
                <div className="result-message" role="alert">
                  <span className="message-icon">
                    {error.code === 'key' ? <LockKeyhole size={26} /> : <Globe2 size={26} />}
                  </span>
                  <h2>
                    {error.code === 'rate'
                      ? t('请稍后重试')
                      : error.code === 'cancelled'
                        ? t('搜索已取消')
                        : t('搜索失败')}
                  </h2>
                  <p>{error.message}</p>
                  <div>
                    {error.code === 'key' ? (
                      <button className="button primary" onClick={() => setModal('settings')}>
                        {t('打开设置')} <ArrowRight size={16} />
                      </button>
                    ) : error.code === 'balance' ? (
                      <a
                        className="button primary"
                        href="https://platform.deepseek.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('前往 DeepSeek 平台')} <ArrowUpRight size={16} />
                      </a>
                    ) : (
                      <button
                        className="button secondary"
                        disabled={cooldown > 0}
                        onClick={() => void search(searchedQuery, true)}
                      >
                        {cooldown > 0 ? t('{n} 秒后重试', { n: cooldown }) : t('重试')}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {response && (
                <>
                  {response.persistenceWarning && (
                    <p className="feedback error" role="status">
                      {t('结果已获取，但本地存储失败，历史和缓存可能未保存。')}
                    </p>
                  )}
                  {!response.results.length ? (
                    <div className="result-message">
                      <span className="message-icon">
                        <Search size={26} />
                      </span>
                      <h2>{t('无结果')}</h2>
                      <p>{t('没有找到匹配的网页。试试更简短的关键词，或减少搜索条件。')}</p>
                    </div>
                  ) : (
                    <ol className="results-list">
                      {sortResults(response.results, state.settings.sortBy).map((r) => (
                        <li key={r.url} className="result-card">
                          <div className="result-top">
                            <span className="result-site-icon">
                              {(r.siteName || new URL(r.url).hostname).slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <span className="site-name">
                                {r.siteName || new URL(r.url).hostname}
                              </span>
                              <span className="site-domain">{new URL(r.url).hostname}</span>
                            </div>
                          </div>
                          <h2>
                            <a
                              href={safeUrl(r.url) || undefined}
                              onClick={(e) => onLinkClick(e, r.url)}
                              {...linkProps}
                            >
                              {r.title}
                              <ArrowUpRight size={17} />
                            </a>
                          </h2>
                          {r.snippet && <p className="result-snippet">{r.snippet}</p>}
                          {state.settings.needContent && r.content && (
                            <details>
                              <summary>{t('网页正文（最多显示 12,000 字符）')}</summary>
                              <p className="result-snippet">{r.content}</p>
                            </details>
                          )}
                          {state.settings.showSummary && r.summary && (
                            <details>
                              <summary>{t('长摘要')}</summary>
                              <p className="result-snippet">{r.summary}</p>
                            </details>
                          )}
                          {state.settings.showScores &&
                            (r.score != null || (r.authority != null && r.authority >= 0)) && (
                              <p className="result-snippet">
                                {r.score != null && t('排序 {n}/3', { n: r.score })}
                                {r.score != null &&
                                  r.authority != null &&
                                  r.authority >= 0 &&
                                  ' · '}
                                {r.authority != null &&
                                  r.authority >= 0 &&
                                  t('权威性 {n}/4', { n: r.authority })}
                              </p>
                            )}
                          <div className="result-meta">
                            {r.date && (
                              <time dateTime={r.date}>
                                <Clock3 size={12} />
                                {new Date(r.date).toLocaleDateString(dateLocale(), {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </time>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </main>
      <aside className="rail" aria-label={t('工具栏')}>
        <div className="rail-head">
          <div>
            <div className="clock">
              <time dateTime={clock.toISOString()}>{clockText}</time>
              {meridiem && <span>{meridiem.toLowerCase()}</span>}
            </div>
            <div className="date">
              {clock.toLocaleDateString(dateLocale(), {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>
          <nav className="top-actions" aria-label={t('页面工具')}>
            <button
              className="icon-button"
              aria-label={dark ? t('切换到浅色模式') : t('切换到深色模式')}
              title={dark ? t('切换到浅色模式') : t('切换到深色模式')}
              onClick={() =>
                void setPreference({ theme: dark ? 'light' : 'dark' }).catch(() =>
                  setToast(t('保存失败，请重试。')),
                )
              }
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              className="icon-button"
              aria-label={t('切换语言')}
              title="中文 / English"
              onClick={() =>
                void setPreference({ locale: state.settings.locale === 'en' ? 'zh' : 'en' }).catch(
                  () => setToast(t('保存失败，请重试。')),
                )
              }
            >
              <Languages size={19} />
            </button>
            <button
              className="icon-button"
              aria-label={t('API 用量与余额')}
              title={t('API 用量与余额')}
              onClick={() => setModal('billing')}
            >
              <BarChart3 size={19} />
            </button>
            <button
              className="icon-button"
              aria-label={t('搜索历史')}
              title={t('搜索历史')}
              onClick={() => setModal('history')}
            >
              <History size={19} />
            </button>
            <button
              className="icon-button"
              aria-label={t('打开设置')}
              title={t('设置')}
              onClick={() => setModal('settings')}
            >
              <Settings2 size={19} />
            </button>
          </nav>
        </div>
        <nav className="rail-links" aria-label={t('快捷链接')}>
          {state.links.map((link, at) => (
            <a
              key={link.id}
              href={safeUrl(link.url) || undefined}
              onClick={(e) => onLinkClick(e, link.url)}
              {...linkProps}
            >
              <LinkIcon url={link.url} title={link.title} />
              <span className="link-title">{link.title}</span>
              <kbd>{at < 9 ? `⌥${at + 1}` : ''}</kbd>
            </a>
          ))}
          {state.links.length < 8 && (
            <button type="button" onClick={() => setAddingLink(true)}>
              {t('添加链接')}
            </button>
          )}
        </nav>
      </aside>
      {aiNotice && (
        <Modal title={t('使用 AI 回答')} onClose={() => setAiNotice(null)}>
          <p className="field-help">
            {t(
              '每次 AI 回答会向 DeepSeek 发送一次搜索请求和一次模型请求，两者都可能产生 API 费用。只有你的问题和搜索结果会被发送，不包含标签页、书签或浏览历史。回答仅保留在当前页面。',
            )}
          </p>
          <footer className="modal-footer">
            <button className="text-button" type="button" onClick={() => setAiNotice(null)}>
              {t('取消')}
            </button>
            <button
              className="button primary"
              type="button"
              onClick={() => {
                const pending = aiNotice;
                setAiNotice(null);
                void setPreference({ aiAcknowledged: true }).catch(() => {});
                void startAi(pending.q, pending.results, true);
              }}
            >
              {t('继续')}
            </button>
          </footer>
        </Modal>
      )}
      {addingLink && (
        <LinkModal
          count={state.links.length}
          onClose={() => setAddingLink(false)}
          onSaved={() => setToast('快捷链接已保存')}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}
      {modal === 'billing' && <BillingModal onClose={closeModal} />}
      {modal === 'settings' && (
        <SettingsModal state={state} onClose={closeModal} onSaved={setToast} cooldown={cooldown} />
      )}
      {modal === 'history' && (
        <HistoryModal
          state={state}
          onClose={closeModal}
          onSearch={(q) => void search(q)}
          onClear={() => void clearHistory()}
        />
      )}
    </div>
  );
}
