// This preference contains no private data. All other data uses chrome.storage.local.
const saved = localStorage.getItem('seektab-theme');
document.documentElement.dataset.theme =
  saved === 'dark' || saved === 'light'
    ? saved
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
