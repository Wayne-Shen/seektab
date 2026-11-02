// This preference contains no private data. All other data uses chrome.storage.local.
const saved = localStorage.getItem('seektab-theme');
document.documentElement.dataset.theme =
  saved === 'dark' || saved === 'light'
    ? saved
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
const accent = localStorage.getItem('seektab-accent');
document.documentElement.dataset.accent = ['amber', 'sky', 'mint', 'coral'].includes(accent ?? '')
  ? accent!
  : 'amber';
