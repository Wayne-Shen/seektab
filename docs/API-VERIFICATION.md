# DeepSeek Search API verification

Checked against official documentation on **2026-10-22**, before implementing the adapter.

## Contract used by SeekTab

- `POST https://api.deepseek.com/v1/tools/search` with a JSON body and `Authorization: Bearer <API key>`.
- The MVP sends `{ query, count, need_content: false }`. Queries must be non-empty and contain at most 128 Unicode code points. The provider allows result counts from 1 to 50; the UI offers 5, 10, and 20.
- Optional `ori_question` and `localization` fields are omitted. SeekTab does not collect an IP address or call Fetch/chat endpoints.
- Successful responses contain a top-level `results` array. The UI uses `title`, `url`, `snippet`, `site_name`, and `date`.
- A null site name falls back to the hostname; a missing/invalid date is omitted.
- The provider also defines summaries, page content, remote icons, relevance scores, and authority fields. The MVP does not display or cache those fields or download remote icons.
- An empty result array is a successful search with no matches.
- HTTP failures map to local messages without exposing the provider's raw error body. Requests are not retried automatically.
- For 429, the adapter honors `Retry-After` seconds or an HTTP date when present. A missing header falls back to a 10-second local wait; that fallback is a product choice, not a provider guarantee.
- Query length is counted with `[...query].length`. Result URLs must use HTTP/HTTPS without embedded credentials. React renders result text with escaping.

## Browser architecture

Chrome's extension documentation permits cross-origin fetch from extension pages when host permissions are declared. SeekTab therefore requests the fixed provider endpoint directly from the extension's New Tab page. There is no proxy or background message bridge, and no assumption that an ordinary website has the same network privileges.

Requests omit cookies and referrers and reject redirects. One same-origin Web Lock coordinates network requests; another serializes local read/modify/write operations. Cached results have a fixed 15-minute lifetime and bounded capacity. A privacy revision prevents a request already in progress from saving data after the user clears history/cache.

## Official references

- [DeepSeek Search API reference](https://api-docs.deepseek.com/api/search/)
- [DeepSeek Search & Fetch guide](https://api-docs.deepseek.com/zh-cn/guides/search/)
- [Chrome extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome page overrides](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)

The documented contract is implemented and exercised with mock responses. Access for a particular account, real key authentication, live result quality, and the user's network environment require testing with that user's key after installation.
