# Contributing to SeekTab

Thanks for helping improve SeekTab. Small, focused changes are easiest to review.

## Set up

Use Node.js 22.12+ (Node.js 24 is used in CI):

```sh
npm ci
npm run build
```

Load `dist/` as an unpacked extension through `chrome://extensions`. Rebuild and reload the extension after making changes. A normal Vite webpage cannot provide the complete Chrome extension storage environment.

## Before opening a pull request

```sh
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Use `npm run format` to apply formatting. Browser tests use mock API responses and an isolated temporary profile. Do not add real API keys or make paid network calls in tests.

Describe the problem, expected behavior, change, and relevant validation. Include a screenshot for visible UI changes. Keep the English README and [Chinese README](README_CN.md) aligned when changing installation or user-facing behavior.

## Project scope

The MVP is a personal, local BYOK web-search extension. Preserve its narrow permissions, direct provider requests, explicit key handling, bounded local data, and escaped rendering of untrusted results. Discuss features that require a backend, new permissions, or generated AI answers before implementation.

Do not commit `node_modules/`, `dist/`, `release/`, browser profiles, personal history, or secrets. New production dependencies should have a clear purpose and appropriate license notices.

## Reporting bugs

Include the Chrome version, operating system, steps to reproduce, and what you expected. Redact API keys, account information, and private search terms from screenshots and logs. Use the private reporting guidance in [SECURITY.md](SECURITY.md) for vulnerabilities.

Contributions are provided under the project's [MIT license](LICENSE).
