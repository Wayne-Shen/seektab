import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import { normalizeLocale, setLocale, t } from './lib/i18n';

setLocale(normalizeLocale(undefined, navigator.language));

class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>{t('页面暂时遇到问题')}</h1>
        <p>{t('你的设置仍保存在本机。请刷新此标签页，或在扩展管理页重新加载 SeekTab。')}</p>
        <button onClick={() => location.reload()}>{t('重新加载')}</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
