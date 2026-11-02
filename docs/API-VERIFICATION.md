# DeepSeek Search API verification

## 2026-11-02 AI answers (Responses API)

Checked the official Responses guide and the Search/Fetch guide on 2026-11-02. Used contract: `POST https://api.deepseek.com/responses`, Bearer authentication, `{ model, instructions, input, stream: true, max_output_tokens }`; models `deepseek-flash` (default) and `deepseek-v4-pro`. The built-in `web_search` tool is only supported by `deepseek-v4-pro` and is **not** used. The API is stateless (no `previous_response_id`). Streaming reads `response.output_text.delta` (text) and `response.completed` / `response.incomplete` (`response.usage.input_tokens` / `output_tokens`); `response.failed` is an error; reasoning events are ignored. Fetch (`POST /v1/tools/fetch`) is not used. The user reported on 2026-11-02 that a streamed AI answer works with their own key after the parser was made tolerant (the first attempt with a 1000-token limit returned no text). **Not verified:** the non-streaming response shape, AI pricing, and per-model limits; automated tests mock the endpoint. Re-check the official docs before changing these fields.

## Balance and local usage reporting

Checked 2026-11-02: the official `GET https://api.deepseek.com/user/balance` returns account availability and balance rows, including currency and total, granted and topped-up balances as strings. No public account-wide usage-history API was identified in the official API reference. SeekTab keeps its own daily request counts, which are not authoritative billing records, and fetches balance only on explicit report refresh. [Official balance reference](https://api-docs.deepseek.com/api/get-user-balance/).

## 2026-11-02 advanced Search recheck

Official Search reference and Search & Fetch guide confirm `query`, `count` (1–50), `ori_question`, `localization` (IP address), `need_content`, documented query operators, `summary`, `content`, `authority`, and `rerank_score`. SeekTab v1.2.0 exposes these Search capabilities. Manually entered IPv4 localization is opt-in; advanced requests bypass the result cache, and body text is not persisted. Original questions are sent when configured filters alter the query. Fetch and AI responses are separate APIs and are not implemented. See the official references below.

The section below records the original v1.0.0 verification.

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
