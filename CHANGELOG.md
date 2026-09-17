# Changelog

All notable changes to `vite-plugin-proxy-enhancer` are documented here.

This project follows [Semantic Versioning](https://semver.org/).

---

## [0.2.0] — 2026-09-17

### Added
- **Cookie injection**: inject arbitrary cookies into every proxied response via `cookieRewrite.inject` — zero backend changes required.
- **Response body logging**: `log.showBody` now safely buffers response chunks up to 16 KB, decompresses `gzip` / `deflate` / `br` automatically, and pretty-prints valid JSON.
- **Secure-cookie warning**: when a `Secure` cookie is detected coming from an HTTP target, the plugin emits a one-time, actionable warning pointing to the recommended fix (`secure: false, sameSite: 'lax'`).
- **VHS terminal demo** (`demo.tape`): a fully self-contained demo that renders to an animated GIF — see `vhs demo.tape`.

### Changed
- **`secure: false` is now the smart default** for cookie rewriting on HTTP targets. Previously, `secure: false` in `CookieRewriteOptions` was a no-op; it now actively strips the `Secure` flag (equivalent to `removeSecure: true`). This prevents browsers silently dropping cookies on `http://localhost`.
- **SameSite=None invariant is preserved**: even with `secure: false`, if the resulting cookie has `SameSite=None`, the `Secure` flag is restored (browsers require it).
- **`COOKIE_DEFAULTS`** now includes `secure: false` so enabling `cookieRewrite: true` works correctly out of the box for local HTTP development.
- **Example folder completely overhauled**:
  - `mock-api.mjs`: richer backend with `/api/me` auth round-trip, `/api/login` with 3 misbehaving cookies, WebSocket echo, and colored console output.
  - `index.html`: new interactive demo page (Catppuccin Mocha theme) with 4 feature cards covering login, session, injection, and WebSocket.
  - `vite.config.ts`: numbered inline comments explaining why each `cookieRewrite` option is needed for localhost development.
- **README completely rewritten**: clear problem statement with 3 numbered failure modes, comparison table, quick-start block, 8 real-world recipes, full config reference, and a troubleshooting checklist.

### Fixed
- `rewriteCookie`: `secure: false` previously had no effect; it now correctly removes the `Secure` attribute.
- Body capturing uses `Buffer` chunks instead of string concatenation to avoid corrupting compressed payloads.

---

## [0.1.0] — 2026-09-17

Initial public release.

### Features
- **Cookie rewriting**: rewrite or strip `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite`, and `__Host-` / `__Secure-` prefixes on proxied responses.
- **RFC 6265-safe `Set-Cookie`**: multiple `Set-Cookie` headers are always preserved as separate header fields, fixing [vitejs/vite#23450](https://github.com/vitejs/vite/issues/23450).
- **Cookie injection**: add cookies to every proxied response via `inject`.
- **Per-rule logging**: method, URL, status, duration, target, request/response headers, response body, and cookie-rewrite summaries.
- **Global defaults + per-rule overrides**.
- **WebSocket proxying** (`ws: true`).
- **Full Vite compatibility**: every native `ProxyOptions` field passes through untouched.
- **Fail-fast config validation** with actionable `[proxy-enhancer]` errors.
- Supports Vite 5–8, Node.js ≥ 18.
