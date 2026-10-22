# Security

SeekTab is a personal BYOK extension. It stores the API key locally without encryption and sends submitted queries directly to DeepSeek over HTTPS. See the README for the permission and data model.

## Reporting a vulnerability

Do not post credentials, personal search data, or exploit details in a public issue.

Use this repository's **Security → Report a vulnerability** option when private vulnerability reporting is available. If that option is unavailable, open an issue asking the maintainer for a private reporting channel without disclosing the vulnerability details or any sensitive data.

Include the affected version, reproduction steps using dummy credentials, and the potential impact. No response-time or support guarantee is offered.

## Development expectations

- Keep requests restricted to the fixed official provider endpoint.
- Do not add content-script bridges, remote code, analytics, or broader permissions without discussing the change.
- Render provider content as text and validate destination URLs.
- Never commit a real API key or browser profile.
- Keep security-relevant changes covered by focused tests.
