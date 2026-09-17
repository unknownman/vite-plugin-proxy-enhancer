# vite-plugin-proxy-enhancer

Enhance the [Vite](https://vitejs.dev) dev-server proxy with **cookie rewriting**, **guaranteed multiple `Set-Cookie` support**, per-rule defaults, WebSocket proxying, and readable request logging — while staying 100% compatible with Vite's native `server.proxy` options.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { proxyEnhancer } from "vite-plugin-proxy-enhancer";

export default defineConfig({
  plugins: [
    proxyEnhancer({
      proxies: [
        {
          pattern: "/api",
          target: "http://localhost:3001",
          cookieRewrite: { rewriteDomain: true, path: "/" },
        },
      ],
    }),
  ],
});
```

---

## The problem

Proxying an API through the Vite dev server is one line of config — until real cookies and real responses show up:

- **Auth cookies silently disappear.** Your backend sets `Set-Cookie: session=abc; Domain=api.example.com; Path=/api`. The browser is on `http://localhost:5173`, the `Domain` doesn't match, and the cookie is rejected. The next request has no session, login loops, and nothing is logged.
- **`SameSite` / `Secure` / `__Host-` rules are easy to get wrong.** `SameSite=None` is invalid without `Secure`; `__Host-` cookies must set `Path=/` and must not set `Domain`; a `Secure` cookie won't be stored over plain `http://localhost`. Backends ship flags that are correct in production but fatal in development.
- **Multiple `Set-Cookie` headers get mangled.** Per [RFC 6265 §4.1](https://www.rfc-editor.org/rfc/rfc6265#section-4.1), each cookie must be its own `Set-Cookie` header — commas can't join them (cookie values and `Expires` dates contain commas). When a proxy folds them into one string, the browser keeps only the first cookie and **drops the rest** (e.g. session + CSRF, or token + refresh token on logout). See [vitejs/vite#23450](https://github.com/vitejs/vite/issues/23450) and [mswjs/msw#640](https://github.com/mswjs/msw/issues/640).
- **The proxy is a black box.** Requests fail with terse errors and no visibility into what was forwarded, matched, or rewritten.

`vite-plugin-proxy-enhancer` fixes all four by layering cookie rewriting and logging on top of Vite's own proxy middleware — as a single drop-in plugin.

---

## Installation

```bash
npm install -D vite-plugin-proxy-enhancer
# or
pnpm add -D vite-plugin-proxy-enhancer
# or
yarn add -D vite-plugin-proxy-enhancer
```

## Requirements

- Vite 5, 6, 7, or 8 (`peerDependencies: "vite": "^5 || ^6 || ^7 || ^8"`).
- Node.js 18+.

## Quick start

Add the plugin to `vite.config.ts` and list your routes under `proxies` instead of Vite's `server.proxy`:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { proxyEnhancer } from "vite-plugin-proxy-enhancer";

export default defineConfig({
  plugins: [
    proxyEnhancer({
      proxies: [
        {
          pattern: "/api/**",              // matched like Vite's server.proxy
          target: "http://localhost:3001", // backend during local development
          cookieRewrite: true,             // enable cookie rewriting
        },
      ],
    }),
  ],
});
```

Requests to `/api/...` are forwarded to `http://localhost:3001`, cookies are rewritten, and each request is logged:

```
  [09:41:13] INFO  Configuring 1 proxy entry
  [09:41:14] GET /api/users → 200 OK 42.1ms ⇢ http://localhost:3001
```

That's it — no `server.proxy` block required.

---

## What you get

- 🍪 **Cookie rewriting** — rewrite or strip `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite` and `__Host-` / `__Secure-` prefixes on proxied responses, inject extra cookies, and **never emit an invalid cookie**.
- 🧩 **RFC 6265-safe `Set-Cookie`** — multiple `Set-Cookie` headers are always preserved as separate header fields, end to end.
- 🔧 **Full Vite compatibility** — every native `ProxyOptions` field (`rewrite`, `bypass`, `ws`, `headers`, `configure`, `proxyTimeout`, `auth`, `xfwd`, …) passes through untouched.
- 🎛️ **Global defaults, per-rule overrides** — configure once, override where needed.
- 🔌 **HTTP + WebSocket** — normal requests and `ws:` upgrades both log correctly.
- 📝 **Granular logging** — method, URL, status, duration and target per request; opt into headers, body, matched pattern, and cookie-rewrite summaries.
- 🛡️ **Fails loud, fails safe** — invalid config throws a descriptive error at startup; a runtime hiccup (e.g. one unparseable cookie) is caught and logged without killing the proxy.

---

## Common recipes

### 1. Local development with a backend on a different port

The most common setup: the Vite dev server runs on `5173`, your API on `3001`.

```ts
proxyEnhancer({
  proxies: [
    {
      pattern: "/api",
      target: "http://localhost:3001",
      // changeOrigin defaults to true, so the Host header becomes
      // "localhost:3001" — what most backends expect.
    },
  ],
});
```

If your backend expects the API prefix stripped, add the native `rewrite` option:

```ts
{
  pattern: "/api",
  target: "http://localhost:3001",
  rewrite: (path) => path.replace(/^\/api/, ""),
  // /api/users -> http://localhost:3001/users
}
```

Override the target per environment with `loadEnv`:

```ts
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      proxyEnhancer({
        proxies: [
          { pattern: "/api", target: env.API_URL ?? "http://localhost:3001" },
        ],
      }),
    ],
  };
});
```

### 2. Fixing `SameSite` / `Secure` issues

Backends commonly issue `SameSite=None` without `Secure` (invalid, so the cookie is dropped), or scope cookies in ways that only make sense in production.

**Cookie rejected because `SameSite=None` has no `Secure`** — the plugin adds `Secure` automatically whenever `SameSite=None` is present, but a `Secure` cookie is **not stored over `http://localhost`**. For plain-HTTP development, prefer `SameSite=Lax`:

```ts
{
  pattern: "/api",
  target: "https://api.example.com",
  cookieRewrite: {
    sameSite: "Lax",   // relaxed for the dev origin
    secure: false,     // don't force Secure over http://
    path: "/",
  },
}
```

**Cookie rejected because the `Domain` doesn't match `localhost`** — strip it so the cookie binds to the dev-server origin:

```ts
cookieRewrite: {
  rewriteDomain: true, // remove "Domain=api.example.com"
  path: "/",           // valid for the whole app, not just /api
  secure: false,
}
```

**Cross-site cookies behind HTTPS** (e.g. a proxy at `https://dev.example.com` talking to another origin) — pin the domain and keep `SameSite=None` valid:

```ts
cookieRewrite: {
  domain: ".example.com",
  path: "/",
  sameSite: "None", // plugin adds Secure automatically
}
```

**Prefixed cookies (`__Host-` / `__Secure-`) never stick** — these have browser-enforced rules. Diagnose with the exported helper, or strip the prefix in development:

```ts
import { parseSetCookieString, checkPrefixRequirements } from "vite-plugin-proxy-enhancer";

const cookie = parseSetCookieString("__Host-session=abc; Path=/; Secure")!;
console.log(checkPrefixRequirements(cookie).violations); // []
```

```ts
cookieRewrite: { removePrefixes: true } // __Host-session -> session
```

> The plugin never produces an invalid cookie: `SameSite=None` always keeps `Secure`, prefixed cookies always keep `Secure`, and a `__Host-` cookie is auto-de-prefixed when a `Domain` conflicts or `Path` isn't `/`.

### 3. Injecting debug cookies

Set a feature flag or bypass an entitlement check without touching the backend. Injected cookies are added to **every** proxied response for that rule and inherit the rule's `domain`, `path`, `secure`, `httpOnly`, and `sameSite` settings:

```ts
{
  pattern: "/api",
  target: "http://localhost:3001",
  cookieRewrite: {
    path: "/",
    inject: {
      feature_flag: "on",
      "seen-tutorial": "yes",
    },
  },
}
```

```
Set-Cookie: feature_flag=on; Path=/
Set-Cookie: seen-tutorial=yes; Path=/
```

### 4. Disabling logging for specific routes

Health checks and polling endpoints are noisy. Silence a single rule with `log: false`:

```ts
proxyEnhancer({
  logger: { level: "info" },
  proxies: [
    {
      pattern: "/api/health",            // silent
      target: "http://localhost:3001",
      log: false,
    },
    {
      pattern: "/api/**",                // everything else is logged
      target: "http://localhost:3001",
    },
  ],
});
```

Per-rule options are merged over the global `logger`, so you can also just crank one rule down:

```ts
{ pattern: "/api/metrics", target: "http://localhost:3001", log: { level: "warn" } }
```

Turn **all** logging off with the global logger:

```ts
proxyEnhancer({ logger: { level: "silent" }, proxies: [...] });
```

### 5. Proxy WebSockets

```ts
{ pattern: "/ws", target: "ws://localhost:3002", ws: true }
```

Upgrades are logged with their `101` status. `rewriteWsOrigin` passes through if your backend validates the `Origin` header during the handshake.

### 6. Keep your existing `server.proxy` entries

The plugin merges into `server.proxy` rather than replacing it, so hand-written entries keep working. It warns at config time about patterns it overrides and about unmanaged patterns, so nothing is double-defined by accident:

```ts
export default defineConfig({
  server: {
    proxy: {
      "/legacy": "http://localhost:8080", // untouched by the plugin
    },
  },
  plugins: [
    proxyEnhancer({
      proxies: [{ pattern: "/api", target: "http://localhost:3001" }],
    }),
  ],
});
```

---

## Configuration reference

### `proxyEnhancer(options)`

```ts
import { proxyEnhancer } from "vite-plugin-proxy-enhancer";
import type { PluginOptions } from "vite-plugin-proxy-enhancer";

const options: PluginOptions = {
  // Required: one entry per proxy route.
  proxies: [],

  // Optional: merged into every entry (per-entry options win).
  defaults: { changeOrigin: true, cookieRewrite: true },

  // Optional: global logging.
  logger: { level: "info", logMatches: true },
};

proxyEnhancer(options);
```

### `PluginOptions`

| Option     | Type                             | Default   | Description                                         |
| ---------- | -------------------------------- | --------- | --------------------------------------------------- |
| `proxies`  | `EnhancedProxyOptions[]`         | —         | Proxy rules to create. **Required.**                |
| `defaults` | `Partial<Omit<EnhancedProxyOptions, "pattern">>` | `{}` | Settings merged into every rule.       |
| `logger`   | `LoggerOptions`                  | see below | Global log options, overridable per rule.           |

### `EnhancedProxyOptions`

`pattern` and `target` are the plugin's own fields; **every other field is a standard Vite `ProxyOptions` / http-proxy option** and passes through untouched.

```ts
import type { EnhancedProxyOptions } from "vite-plugin-proxy-enhancer";

const rule: EnhancedProxyOptions = {
  pattern: "/api/**",              // required
  target: "https://api.example.com", // required
  cookieRewrite: {                 // plugin
    rewriteDomain: true,
    path: "/",
    secure: false,
  },
  log: { level: "debug", showBody: true }, // plugin

  ws: true,                        // native Vite / http-proxy
  rewrite: (path) => path.replace(/^\/api/, ""),
  bypass: (req) => (req.url?.includes("health") ? "/index.html" : undefined),
  headers: { "x-proxied-by": "vite" },
  proxyTimeout: 30_000,
  configure: (proxy) => {
    // Composed with the plugin's own handlers — runs first, never replaces them.
  },
};
```

| Option           | Type                                | Default | Description                                                                 |
| ---------------- | ----------------------------------- | ------- | --------------------------------------------------------------------------- |
| `pattern`        | `string`                            | —       | Route to match: `"/api"`, glob `"/api/**"`, or RegExp source when prefixed with `^` (`"^/api/.*"`). Must start with `/` or `^`. |
| `target`         | `string`                            | —       | Target server, e.g. `"http://localhost:3001"` or `"https://api.example.com"`. Only `http:` / `https:` are supported. |
| `cookieRewrite`  | `CookieRewriteOptions \| boolean`   | `false` | Rewrite/inject cookies. `true` = defaults; object = options; `false` = off. |
| `log`            | `boolean \| LoggerOptions`          | `true`  | Per-rule logging. `false` disables; object overrides the global `logger`.   |
| `changeOrigin`   | `boolean`                           | `true`  | Rewrite the request `Host` header to the target.                            |
| `secure`         | `boolean`                           | `true`  | Verify the target's TLS certificate (set `false` for self-signed certs).    |
| `rewrite`        | `(path: string) => string`          | —       | Rewrite the path before proxying (native Vite).                             |
| `bypass`         | `(req, res, options) => void \| …`  | —       | webpack-dev-server-style bypass (native Vite).                              |
| `ws`             | `boolean`                           | `false` | Proxy WebSocket upgrades.                                                   |
| `rewriteWsOrigin`| `boolean`                           | —       | Rewrite the WebSocket `Origin` header to the target.                        |
| `headers`        | `object`                            | —       | Headers added to proxied requests.                                          |
| `configure`      | `(proxy, options) => void`          | —       | Tune the underlying `http-proxy` server. The plugin runs your callback first, then attaches its own handlers. |
| `proxyTimeout`, `timeout`, `xfwd`, `auth`, `followRedirects`, `preserveHeaderKeyCase`, … | — | — | All remaining http-proxy options are supported. |
| `cookieDomainRewrite` / `cookiePathRewrite` | —           | —       | http-proxy's own (cruder) cookie rewriting still works; use `cookieRewrite` for anything serious. |

### `CookieRewriteOptions`

```ts
import type { CookieRewriteOptions } from "vite-plugin-proxy-enhancer";

const cookieRewrite: CookieRewriteOptions = {
  rewriteDomain: true,                 // strip Domain (→ applies to the dev origin)
  path: "/",                           // scope to the whole app
  secure: false,                       // don't force Secure over http://
  sameSite: "Lax",
  exclude: ["stripe_session"],         // leave these cookies untouched
  inject: { feature_flag: "on" },      // add cookies to every response
};
```

| Option             | Type                    | Default | Description                                                  |
| ------------------ | ----------------------- | ------- | ------------------------------------------------------------ |
| `rewriteDomain`    | `boolean`               | `false` | Deprecated shorthand for `removeDomain`.                     |
| `removeDomain`     | `boolean`               | `false` | Remove the `Domain` attribute.                                |
| `domain`           | `string`                | —       | Replace the `Domain` attribute, e.g. `".example.com"`.        |
| `rewritePath`      | `boolean`               | `false` | Deprecated shorthand for `path: "/"`.                        |
| `removePath`       | `boolean`               | `false` | Remove the `Path` attribute.                                  |
| `path`             | `string`                | —       | Replace the `Path` attribute, e.g. `"/"`.                     |
| `secure`           | `boolean`               | `false` | Ensure the `Secure` flag is set.                              |
| `removeSecure`     | `boolean`               | `false` | Remove the `Secure` flag (overridden if the cookie requires it). |
| `httpOnly`         | `boolean`               | `false` | Ensure the `HttpOnly` flag is set.                            |
| `removeHttpOnly`   | `boolean`               | `false` | Remove the `HttpOnly` flag.                                   |
| `sameSite`         | `"Strict" \| "Lax" \| "None"` | —  | Replace the `SameSite` attribute.                             |
| `removeSameSite`   | `boolean`               | `false` | Remove the `SameSite` attribute.                              |
| `removePrefixes`   | `boolean`               | `false` | Strip `__Host-` / `__Secure-` from cookie names.              |
| `exclude`          | `string[]`              | `[]`    | Cookie names to leave completely untouched.                   |
| `inject`           | `Record<string, string>`| `{}`    | Extra cookies set on every proxied response.                  |

`cookieRewrite: true` enables rewriting with defaults (no attributes changed, nothing injected). Inspect or log real traffic first (`logCookieRewrites`) before adding rules.

**Safety invariants** (applied on top of whatever you configure):

- `SameSite=None` **always** ends up with `Secure` (browsers reject otherwise), even if `removeSecure` is set.
- `__Host-` / `__Secure-` cookies always keep `Secure`.
- A `__Host-` cookie is auto-de-prefixed when a `Domain` is present or `Path` isn't `/` (either would make it invalid); `removePrefixes` strips it explicitly.

### `LoggerOptions`

```ts
import type { LoggerOptions } from "vite-plugin-proxy-enhancer";

const logger: LoggerOptions = {
  level: "info",
  color: true,
  showRequestHeaders: true,
  showResponseHeaders: true,
  showBody: true,          // truncated at 2000 bytes
  logMatches: true,        // show the matched pattern
  logCookieRewrites: true, // summarize rewritten/injected cookies
};
```

| Option                | Type               | Default   | Description                                          |
| --------------------- | ------------------ | --------- | ---------------------------------------------------- |
| `level`               | `"trace" \| "debug" \| "info" \| "warn" \| "error" \| "silent"` | `"info"` | Verbosity for plugin notices and request logs. |
| `color`               | `boolean`          | auto      | ANSI colors (auto-detected).                          |
| `showRequestHeaders`  | `boolean`          | `false`   | Print proxied request headers.                        |
| `showResponseHeaders` | `boolean`          | `false`   | Print proxied response headers.                       |
| `showBody`            | `boolean`          | `false`   | Print the response body (truncated at 2000 bytes).    |
| `logMatches`          | `boolean`          | `false`   | Show the matched pattern on each request line.        |
| `logCookieRewrites`   | `boolean`          | `false`   | Summarize injected/rewritten/added cookies per response. |

### Config resolution

Merging precedence, lowest to highest:

```
PROXY_DEFAULTS   (changeOrigin: true, secure: true)
  < defaults     (plugin-level)
  < entry        (per-pattern)
```

- `cookieRewrite`: `undefined`/`false` → disabled · `true` → defaults · object → defaults + object.
- `log`: `undefined`/`true` → enabled with global options · `false` → disabled · object → global + object.

---

## Comparison with plain Vite proxy

Vite's built-in `server.proxy` is powered by [`http-proxy`](https://github.com/http-party/node-http-proxy). This plugin uses the same engine, so you lose nothing — and gain cookie-aware rewriting, guaranteed header handling, and visibility.

| Capability | Plain Vite `server.proxy` | `vite-plugin-proxy-enhancer` |
| --- | :---: | :---: |
| Match patterns, globs, RegExp | ✅ | ✅ |
| `changeOrigin`, `rewrite`, `bypass`, `headers`, `auth`, `xfwd`, `timeout` | ✅ | ✅ (passed through) |
| WebSocket proxying (`ws`) | ✅ | ✅ |
| Custom `configure(proxy, options)` hook | ✅ | ✅ (composed with the plugin's handlers) |
| Rewrite `Domain` / `Path` on cookies | ⚠️ `cookieDomainRewrite` / `cookiePathRewrite` (http-proxy, attribute-only, no validation) | ✅ `cookieRewrite` |
| Rewrite `SameSite` / `Secure` / `HttpOnly` | ❌ | ✅ |
| `__Host-` / `__Secure-` prefix awareness | ❌ | ✅ |
| Inject cookies into responses | ❌ | ✅ |
| Exclude specific cookies | ❌ | ✅ |
| Guarantee multiple `Set-Cookie` headers stay separate | ⚠️ depends on the proxy/mock path | ✅ always, as `string[]` |
| Per-request logging (status, timing, target, headers, body) | ❌ | ✅ |
| Cookie-rewrite summaries | ❌ | ✅ |
| Global defaults + per-rule overrides | ❌ | ✅ |
| Validate config at startup with actionable errors | ❌ | ✅ |
| Warn on overridden / unmanaged `server.proxy` patterns | ❌ | ✅ |

If all you need is `{ "/api": "http://localhost:3001" }`, Vite alone is fine. Reach for this plugin the moment cookies, multiple `Set-Cookie` headers, or proxy debugging are involved.

---

## Troubleshooting

### The cookie still isn't stored by the browser

Work through this in order:

1. **Is `Domain` set to the backend's domain?** A cookie for `api.example.com` is rejected by `localhost`. Use `cookieRewrite: { rewriteDomain: true }`.
2. **Is it `SameSite=None`?** It needs `Secure`, and a `Secure` cookie is **not stored over plain `http://`**. For `http://localhost`, use `sameSite: "Lax"` (or `"Strict"`).
3. **Is it a `__Host-` cookie?** It must have `Path=/` and no `Domain`. Either satisfy that or use `cookieRewrite: { removePrefixes: true }`.
4. **Is the path too narrow?** A cookie scoped to `Path=/api` isn't sent to `/`. Set `path: "/"`.
5. **See what changed.** Enable `logCookieRewrites` and inspect the `Set-Cookie` header in your browser's DevTools → Application → Cookies.

```ts
proxyEnhancer({
  logger: { logCookieRewrites: true },
  proxies: [{ pattern: "/api", target: "http://localhost:3001", cookieRewrite: { rewriteDomain: true, path: "/", sameSite: "Lax" } }],
});
```

### "My requests aren't being proxied at all" (404 / served by Vite)

- The `pattern` must start with `/` (path/glob) or `^` (RegExp). `"api"` will never match — the plugin throws at startup:

  ```
  [proxy-enhancer] Invalid configuration: proxy[0].pattern "api" will never match a request. ...
  ```
- Use `logMatches: true` to confirm which rule (if any) matched. If no request line appears, nothing matched.
- A more specific pattern wins in Vite's matching order; a broad `pattern: "/"` would swallow everything else.

### `ECONNREFUSED` / `502` from the proxy

The target isn't reachable: check the backend is running and the port in `target` is correct. `GET /api/users → ERROR no response` in the logs points here.

### TLS / self-signed certificate errors

For local HTTPS backends with self-signed certificates, disable verification for that rule:

```ts
{ pattern: "/api", target: "https://localhost:8443", secure: false }
```

### WebSocket connection fails

- Set `ws: true` on the rule; WebSocket upgrades are not proxied otherwise.
- The target may stay `http://`/`https://` — the upgrade is transparent.
- If the backend validates `Origin`, set `rewriteWsOrigin: true`.

### Logs aren't showing

- Check the global `logger.level` (default `"info"`; set `"debug"` for more).
- Check the rule doesn't set `log: false`.
- Colors are auto-detected; set `logger: { color: false }` if your terminal log capture is noisy or garbled.

### A startup error mentions `[proxy-enhancer]`

Configuration validation failed. The message names the offending entry and what's wrong — missing `proxies`, a `pattern` that can't match, a missing/invalid `target`, or a non-`http(s)` protocol. See [Error handling](#error-handling).

---

## Set-Cookie preservation (how it works)

`Set-Cookie` is HTTP's designated exceptional header: per [RFC 6265 §4.1](https://www.rfc-editor.org/rfc/rfc6265#section-4.1) each cookie travels in its own header field and **must not** be folded into a comma-separated list (cookie values can't contain commas, `Expires` dates can, and browsers honor only the first cookie of a joined value). The plugin keeps it a pure array end to end:

1. **Extract** — `getSetCookieHeaderValues()` reads every `set-cookie` key (case-insensitive) and flattens `string` / `string[]` / already-collapsed values into individual cookie strings.
2. **Rewrite** — each cookie is parsed, rewritten, and re-serialized independently by `rewriteSetCookieHeaders()`.
3. **Write back** — `setSetCookieHeaderValues()` assigns a fresh `string[]`; Node's `ServerResponse` then emits one `Set-Cookie:` line per element.

These helpers are exported if you need them directly:

```ts
import {
  getSetCookieHeaderValues,
  rewriteCookieString,
  rewriteResponseSetCookies,
  injectResponseCookies,
} from "vite-plugin-proxy-enhancer";
```

## Error handling

- **At startup**, options are validated and a bad config throws with a `[proxy-enhancer]` prefix and an actionable message.
- **At runtime**, a failure in one request never breaks the proxy. For example, an unparseable `Set-Cookie` logs a warning and the response passes through:

  ```
  10:02:11 WARN  cookie rewrite failed for GET /api/users: <reason>
  ```

- **Conflicts**: patterns you also defined under Vite's native `server.proxy` trigger a warning at config time; patterns the plugin doesn't manage are flagged too.

## TypeScript

Fully typed, strict, no `any` in the public API. Everything is importable:

```ts
import {
  proxyEnhancer,
  resolveConfig,
  createLogger,
  rewriteCookieString,
  checkPrefixRequirements,
} from "vite-plugin-proxy-enhancer";

import type {
  PluginOptions,
  EnhancedProxyOptions,
  CookieRewriteOptions,
  LoggerOptions,
  LogLevel,
  ProxyOptions,
} from "vite-plugin-proxy-enhancer";
```

## License

[MIT](./LICENSE)
