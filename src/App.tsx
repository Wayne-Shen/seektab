import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  History,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { safeUrl, SearchError, validateQuery } from './lib/api';
import {
  clearData,
  initialize,
  readState,
  removeApiKey,
  savePreferences,
  setTheme,
  updateState,
} from './lib/store';
import { runSearch, testConnection, type SearchResponse } from './lib/search';
import type { LocalState, QuickLink, Settings } from './lib/types';

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
      aria-labelledby="dialog-title"
    >
      <div className="modal-inner">
        <header className="modal-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭弹窗">
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
      setFeedback({ text: '请填写有效的 API Key，仅粘贴密钥本身。', ok: false });
      return;
    }
    setTesting(true);
    const abort = new AbortController();
    testAbort.current = abort;
    try {
      const ms = await testConnection(key, abort.signal);
      if (!abort.signal.aborted)
        setFeedback({ text: `连接成功 · 搜索接口可用 · ${ms} ms`, ok: true });
    } catch (e) {
      if (!abort.signal.aborted)
        setFeedback({
          text: e instanceof SearchError ? e.message : '测试失败，请检查本地存储和网络后重试。',
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
      onSaved('设置已保存在本机');
      onClose();
    } catch (e) {
      setFeedback({ text: e instanceof Error ? e.message : '保存失败，请重试。', ok: false });
    } finally {
      setSaving(false);
    }
  }
  async function clear(kind: 'history' | 'cache') {
    try {
      await clearData(kind);
      setDataFeedback(kind === 'history' ? '搜索历史已清除' : '搜索缓存已清除');
    } catch {
      setDataFeedback('清除失败，请重试');
    }
  }
  return (
    <Modal
      title="让 SeekTab 更适合你"
      subtitle="你的密钥、偏好与搜索记录，仅保存在本机。"
      onClose={onClose}
      wide
    >
      <form onSubmit={save}>
        <section className="settings-section">
          <div className="section-label">
            <LockKeyhole size={17} />
            <h3>连接 DeepSeek</h3>
            <span className="tag">BYOK</span>
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
              placeholder="粘贴你的 API Key"
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
              aria-label={visible ? '隐藏密钥' : '显示密钥'}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p className="field-help">
            密钥存于 Chrome 本地存储，不会同步。具有本机访问权限的人可能读取它。
            <a
              href="https://platform.deepseek.com/api_keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              获取密钥 <ExternalLink size={12} />
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
              {testing ? '正在测试…' : cooldown > 0 ? `请等待 ${cooldown} 秒` : '测试连接'}
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
                    setFeedback({ text: '已移除本机保存的密钥', ok: true });
                  } catch {
                    setFeedback({ text: '移除失败，请重试。', ok: false });
                  }
                }}
              >
                移除已存密钥
              </button>
            )}
          </div>
          <p className="tiny muted">
            测试会向 DeepSeek 发送一次「DeepSeek」搜索，可能产生 API 费用；不会写入历史或缓存。
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
            <h3>外观与搜索</h3>
          </div>
          <div className="settings-grid">
            <label className="field-label">
              主题
              <select
                value={draft.theme}
                onChange={(e) => patch({ theme: e.target.value as Settings['theme'] })}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label className="field-label">
              每次返回
              <select
                value={draft.count}
                onChange={(e) => patch({ count: Number(e.target.value) })}
              >
                <option value={5}>5 条结果</option>
                <option value={10}>10 条结果</option>
                <option value={20}>20 条结果</option>
              </select>
            </label>
          </div>
          <Toggle
            label="在新标签页打开链接"
            description="保留当前搜索结果，继续探索。"
            checked={draft.openNewTab}
            onChange={(openNewTab) => patch({ openNewTab })}
          />
        </section>
        <section className="settings-section">
          <div className="section-label">
            <ShieldCheck size={17} />
            <h3>本地数据</h3>
          </div>
          <Toggle
            label="记住搜索历史"
            description="保存最近 50 条成功搜索，关闭会清除历史。"
            checked={draft.historyEnabled}
            onChange={(historyEnabled) => patch({ historyEnabled })}
          />
          <Toggle
            label="缓存搜索结果"
            description="15 分钟内复用相同搜索，最多保存 20 组。关闭会清除缓存。"
            checked={draft.cacheEnabled}
            onChange={(cacheEnabled) => patch({ cacheEnabled })}
          />
          <div className="data-actions">
            <button className="text-button" type="button" onClick={() => clear('history')}>
              <Trash2 size={14} />
              清除历史（{state.history.length}）
            </button>
            <button className="text-button" type="button" onClick={() => clear('cache')}>
              <Trash2 size={14} />
              清除缓存（{state.cache.length}）
            </button>
          </div>
          {dataFeedback && (
            <p className="tiny" role="status">
              {dataFeedback}
            </p>
          )}
          <p className="privacy-note">
            搜索词仅在你提交时直发 DeepSeek。无后端、无统计追踪、不读取 Chrome 浏览历史。
            <a
              href="https://api-docs.deepseek.com/zh-cn/guides/search/"
              target="_blank"
              rel="noopener noreferrer"
            >
              接口说明 <ArrowUpRight size={12} />
            </a>
          </p>
        </section>
        <footer className="modal-footer">
          <span className="tiny muted">SeekTab 1.0 · 个人版</span>
          <button className="button primary" type="submit" disabled={saving || testing}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存设置
          </button>
        </footer>
      </form>
    </Modal>
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
      setError('请填写名称和有效的 HTTP / HTTPS 网址。');
      return;
    }
    if (!link && count >= 8) {
      setError('最多添加 8 个快捷链接。');
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
      setError('保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={link ? '编辑快捷链接' : '添加快捷链接'}
      subtitle="留一个位置，给经常到访的网站。"
      onClose={onClose}
    >
      <form onSubmit={submit} className="link-form">
        <label className="field-label">
          名称
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={24}
            placeholder="例如：我的工作台"
            required
          />
        </label>
        <label className="field-label">
          网址
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
                  setError('删除失败，请重试。');
                }
              }}
            >
              <Trash2 size={15} />
              删除链接
            </button>
          ) : (
            <span />
          )}
          <button className="button primary" disabled={busy} type="submit">
            保存链接 <ArrowRight size={16} />
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
    <Modal title="最近的好奇心" subtitle="仅保存在此浏览器中，点击继续搜索。" onClose={onClose}>
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
                {new Date(h.at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </time>
              <ArrowUpRight size={15} />
            </button>
          ))
        ) : (
          <div className="empty-small">
            <History size={28} />
            <p>
              {state.settings.historyEnabled
                ? '新的发现，会从下一次搜索开始。'
                : '历史记录已关闭。'}
            </p>
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <span className="tiny muted">最多保留 50 条</span>
        <button className="text-button danger" onClick={onClear} disabled={!state.history.length}>
          <Trash2 size={14} />
          清除全部历史
        </button>
      </footer>
    </Modal>
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
  const [modal, setModal] = useState<'settings' | 'history' | 'link' | null>(
    location.hash === '#settings' ? 'settings' : null,
  );
  const [editingLink, setEditingLink] = useState<QuickLink | undefined>();
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
        if (active) setFatal(e instanceof Error ? e.message : '无法读取本地设置，请重新加载扩展。');
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
  const dark =
    state?.settings.theme === 'dark' || (state?.settings.theme !== 'light' && systemDark);
  useEffect(() => {
    if (state) {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      localStorage.setItem('seektab-theme', state.settings.theme);
    }
  }, [state?.settings.theme, dark]);
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
    document.title = searchedQuery ? `${searchedQuery} · SeekTab` : 'SeekTab · 新的发现';
  }, [searchedQuery]);
  const cooldown = Math.max(0, Math.ceil(((state?.cooldownUntil || 0) - now) / 1000));
  async function search(value: string, refresh = false) {
    let q: string;
    try {
      q = validateQuery(value);
    } catch (e) {
      setError(e as SearchError);
      searchInput.current?.focus();
      return;
    }
    abortRef.current?.abort();
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
      if (id === requestId.current && !controller.signal.aborted) setResponse(result);
    } catch (e) {
      if (id === requestId.current)
        setError(
          e instanceof SearchError
            ? e
            : new SearchError(
                controller.signal.aborted ? 'cancelled' : 'storage',
                controller.signal.aborted
                  ? '搜索已取消。'
                  : '本地存储暂时不可用，请重新加载扩展后重试。',
              ),
        );
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  function home() {
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
  if (fatal)
    return (
      <main className="fatal">
        <Mark />
        <h1>在 Chrome 中打开 SeekTab</h1>
        <p>{fatal}</p>
      </main>
    );
  if (!state)
    return (
      <main className="boot" aria-label="正在加载 SeekTab">
        <Mark />
        <LoaderCircle className="spin" size={20} />
      </main>
    );
  const linkProps = {
    target: state.settings.openNewTab ? '_blank' : '_self',
    rel: 'noopener noreferrer',
  };
  const searching = !!searchedQuery;
  return (
    <div className={`app ${searching ? 'has-results' : ''}`}>
      <header className="topbar">
        <button className="brand" onClick={home} aria-label="SeekTab 首页">
          <span className="brand-symbol">
            <Mark small />
          </span>
          <span>
            SeekTab<span className="brand-dot">.</span>
          </span>
        </button>
        <nav className="top-actions" aria-label="页面工具">
          <span className="local-badge">
            <span />
            个人搜索空间
          </span>
          <button
            className="icon-button"
            aria-label="搜索历史"
            title="搜索历史"
            onClick={() => setModal('history')}
          >
            <History size={19} />
          </button>
          <button
            className="icon-button"
            aria-label={dark ? '切换浅色主题' : '切换深色主题'}
            title={dark ? '切换浅色主题' : '切换深色主题'}
            onClick={async () => {
              try {
                await setTheme(dark ? 'light' : 'dark');
              } catch {
                setToast('主题保存失败，请重试');
              }
            }}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            className="icon-button"
            aria-label="打开设置"
            title="设置"
            onClick={() => setModal('settings')}
          >
            <Settings2 size={19} />
          </button>
        </nav>
      </header>
      <main className={searching ? 'main results-main' : 'main home-main'}>
        {!searching && (
          <section className="hero">
            <div className="date-line">
              <span className="date-dash" />
              {new Date(now).toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              })}
              <span className="date-dash" />
            </div>
            <p className="eyebrow">A LITTLE CURIOSITY, A NEW POSSIBILITY</p>
            <h1>
              好奇心，<span>从这里开始。</span>
            </h1>
            <p className="hero-subtitle">把问题交给搜索，把时间留给发现。</p>
          </section>
        )}
        {searching && (
          <button className="back-button" onClick={home}>
            <ArrowLeft size={15} />
            返回新标签页
          </button>
        )}
        <section className="search-area" aria-label="网页搜索">
          <form
            className="search-box"
            onSubmit={(e) => {
              e.preventDefault();
              void search(query);
            }}
          >
            <div className="search-input-row">
              <Search size={23} className="search-glyph" />
              <input
                ref={searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="搜索网页，发现更多可能…"
                aria-label="搜索网页"
                aria-describedby="search-hint"
                maxLength={256}
              />
              {query && !busy && (
                <button
                  type="button"
                  className="icon-button clear-query"
                  aria-label="清空搜索词"
                  onClick={() => {
                    setQuery('');
                    searchInput.current?.focus();
                  }}
                >
                  <X size={17} />
                </button>
              )}
              {busy ? (
                <button
                  type="button"
                  className="search-submit stop"
                  onClick={() => abortRef.current?.abort()}
                >
                  <X size={17} />
                  <span>停止</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="search-submit"
                  disabled={!query.trim()}
                  aria-label="提交搜索"
                >
                  <span>搜索</span>
                  <ArrowRight size={19} />
                </button>
              )}
            </div>
            <div className="search-bottom">
              <span className="provider-label">
                <span className="provider-dot" />
                DeepSeek Search
              </span>
              <span className="search-hint" id="search-hint">
                {[...query].length > 100 ? (
                  `${[...query.trim()].length} / 128 字符`
                ) : (
                  <>
                    <kbd>Enter</kbd> 开始探索
                  </>
                )}
              </span>
            </div>
          </form>
          {!state.apiKey && (
            <div className="setup-prompt">
              <span className="setup-icon">
                <LockKeyhole size={18} />
              </span>
              <div>
                <strong>连接你的搜索引擎</strong>
                <p>添加 DeepSeek API Key，开启属于你的搜索空间。</p>
              </div>
              <button onClick={() => setModal('settings')}>
                去设置 <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          {!searching && error && (
            <p className="feedback error" role="alert">
              {error.message}
            </p>
          )}
        </section>
        {!searching ? (
          <>
            <section className="quick-section" aria-labelledby="quick-title">
              <div className="section-heading">
                <h2 id="quick-title">常去的地方</h2>
                <span>YOUR EVERYDAY SHORTCUTS</span>
              </div>
              <div className="quick-links">
                {state.links.map((l, index) => (
                  <div className="quick-item" key={l.id}>
                    <a href={safeUrl(l.url)!} {...linkProps} className="quick-link">
                      <span className={`shortcut-icon shade-${index % 4}`}>
                        {l.title.slice(0, 1).toUpperCase()}
                      </span>
                      <span>{l.title}</span>
                    </a>
                    <button
                      className="edit-link"
                      aria-label={`编辑 ${l.title}`}
                      onClick={() => {
                        setEditingLink(l);
                        setModal('link');
                      }}
                    >
                      <SlidersHorizontal size={12} />
                    </button>
                  </div>
                ))}
                {state.links.length < 8 && (
                  <button
                    className="quick-link add-link"
                    onClick={() => {
                      setEditingLink(undefined);
                      setModal('link');
                    }}
                  >
                    <span className="shortcut-icon">
                      <Plus size={22} />
                    </span>
                    <span>添加快捷链接</span>
                  </button>
                )}
              </div>
            </section>
            {state.history.length > 0 && (
              <section className="recent-section" aria-label="最近搜索">
                <div className="section-heading">
                  <h2>
                    <Clock3 size={14} />
                    最近搜索
                  </h2>
                  <button className="text-button" onClick={() => setModal('history')}>
                    查看全部 <ArrowRight size={13} />
                  </button>
                </div>
                <div className="recent-chips">
                  {state.history.slice(0, 4).map((h) => (
                    <button key={h.query} onClick={() => void search(h.query)}>
                      <span>{h.query}</span>
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className="home-note">
              <span className="small-orbit" />
              <span>每一次提问，都在靠近更大的世界。</span>
            </div>
          </>
        ) : (
          <div className="results-layout">
            <section className="results-column" aria-label="搜索结果" aria-busy={busy}>
              <div className="results-heading">
                <h1>
                  <Globe2 size={16} />
                  网页结果
                </h1>
                <span aria-live="polite">
                  {busy
                    ? '正在寻找…'
                    : response
                      ? `${response.results.length} 条结果${response.fromCache ? ' · 本地缓存' : ''}`
                      : 'DeepSeek Search'}
                </span>
                {response && (
                  <button
                    className="text-button"
                    disabled={cooldown > 0}
                    onClick={() => void search(searchedQuery, true)}
                    title="忽略缓存，重新请求搜索"
                  >
                    刷新结果
                  </button>
                )}
              </div>
              {cooldown > 0 && (
                <div className="rate-notice" role="status">
                  <Clock3 size={16} />
                  <span>服务限流，请在 {cooldown} 秒后重试。缓存结果仍可使用。</span>
                </div>
              )}
              {busy && (
                <div className="loading-results" role="status">
                  <p>
                    <LoaderCircle size={16} className="spin" />
                    正在搜索「{searchedQuery}」
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
                      ? '稍等一下，发现正在路上'
                      : error.code === 'cancelled'
                        ? '这次搜索已暂停'
                        : '暂时没有连上搜索'}
                  </h2>
                  <p>{error.message}</p>
                  <div>
                    {error.code === 'key' ? (
                      <button className="button primary" onClick={() => setModal('settings')}>
                        打开设置 <ArrowRight size={16} />
                      </button>
                    ) : error.code === 'balance' ? (
                      <a
                        className="button primary"
                        href="https://platform.deepseek.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        前往 DeepSeek 平台 <ArrowUpRight size={16} />
                      </a>
                    ) : (
                      <button
                        className="button secondary"
                        disabled={cooldown > 0}
                        onClick={() => void search(searchedQuery, true)}
                      >
                        {cooldown > 0 ? `${cooldown} 秒后重试` : '重新搜索'}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {response && (
                <>
                  {response.persistenceWarning && (
                    <p className="feedback error" role="status">
                      结果已获取，但本地存储失败，历史和缓存可能未保存。
                    </p>
                  )}
                  {!response.results.length ? (
                    <div className="result-message">
                      <span className="message-icon">
                        <Search size={26} />
                      </span>
                      <h2>换个角度，继续探索</h2>
                      <p>没有找到匹配的网页。试试更简短的关键词，或减少搜索条件。</p>
                    </div>
                  ) : (
                    <ol className="results-list">
                      {response.results.map((r, index) => (
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
                            <span className="result-index">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                          </div>
                          <h2>
                            <a href={safeUrl(r.url) || undefined} {...linkProps}>
                              {r.title}
                              <ArrowUpRight size={17} />
                            </a>
                          </h2>
                          {r.snippet && <p className="result-snippet">{r.snippet}</p>}
                          <div className="result-meta">
                            {r.date && (
                              <time dateTime={r.date}>
                                <Clock3 size={12} />
                                {new Date(r.date).toLocaleDateString('zh-CN', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </time>
                            )}
                            <a
                              href={safeUrl(r.url) || undefined}
                              {...linkProps}
                              className="result-url"
                              title={r.url}
                            >
                              <Link2 size={12} />
                              {r.url.replace(/^https?:\/\//, '').slice(0, 90)}
                            </a>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="result-end">
                    <CheckCircle2 size={14} />
                    {response.fromCache
                      ? `来自本机缓存 · ${new Date(response.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 保存`
                      : '已展示本次搜索返回的全部结果'}
                  </div>
                </>
              )}
            </section>
            <aside className="search-aside">
              <span className="aside-icon">
                <Mark small />
              </span>
              <h2>让搜索更精准</h2>
              <p>
                一个小小的条件，
                <br />
                也能让答案更近一点。
              </p>
              <div className="search-tips">
                <div>
                  <code>site:github.com</code>
                  <span>只搜索指定网站</span>
                </div>
                <div>
                  <code>"精确短语"</code>
                  <span>寻找完整匹配</span>
                </div>
                <div>
                  <code>lang:zh</code>
                  <span>优先发现中文内容</span>
                </div>
                <div>
                  <code>after:2026-01-01</code>
                  <span>限定网页发布时间</span>
                </div>
              </div>
              <div className="aside-privacy">
                <ShieldCheck size={18} />
                <span>
                  本地保存，直接连接。
                  <br />
                  你的探索，由你掌握。
                </span>
              </div>
            </aside>
          </div>
        )}
      </main>
      <footer className="page-footer">
        <span>
          <ShieldCheck size={13} />
          本地优先 · 由 DeepSeek Search 提供支持
        </span>
        <span className="footer-shortcut">
          <kbd>/</kbd> 聚焦搜索 <span className="footer-divider" />
          保持好奇 <ArrowDown size={12} />
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}
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
      {modal === 'link' && (
        <LinkModal
          link={editingLink}
          count={state.links.length}
          onClose={closeModal}
          onSaved={() => setToast(editingLink ? '快捷链接已更新' : '快捷链接已添加')}
        />
      )}
    </div>
  );
}
