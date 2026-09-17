# vite-plugin-proxy-enhancer

> A Vite plugin that fixes the three most common dev-proxy pain points: **multiple
> `Set-Cookie` headers getting silently mangled**, **cookies rejected by the
> browser on `localhost`**, and a **complete lack of proxy visibility**.

```bash
npm install -D vite-plugin-proxy-enhancer
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { proxyEnhancer } from "vite-plugin-proxy-enhancer";

export default defineConfig({
  plugins: [
    proxyEnhancer({
      defaults: {
        changeOrigin: true,
        cookieRewrite: {
          rewriteDomain: true, // strip Domain=api.example.com → localhost
          path:          "/",  // broaden Path=/api → /
          secure:        false, // don't force Secure over plain http://
          sameSite:      "lax", // replace None (needs Secure) with Lax
        },
      },
      proxies: [
        { pattern: "/api", target: "http://localhost:3001" },
      ],
    }),
  ],
});
```

---

## The problem

Vite's `server.proxy` delegates to [`http-proxy`](https://github.com/http-party/node-http-proxy) and does exactly what you'd expect — until real auth shows up:

### 1 — Multiple cookies are silently dropped

Per [RFC 6265 §4.1](https://www.rfc-editor.org/rfc/rfc6265#section-4.1), each cookie **must travel in its own `Set-Cookie` header**. Merging them into a comma-separated string is invalid (cookie values and `Expires` dates contain commas), and browsers silently keep only the **first** cookie of a folded value. Login responses that set `session + csrf + refresh` become a single broken cookie. See [vitejs/vite#23450](https://github.com/vitejs/vite/issues/23450).

### 2 — Cookie attributes are wrong for localhost

Production backends set cookies for their own domain:

```
Set-Cookie: session=abc; Domain=api.example.com; Path=/api; SameSite=None
```

On `http://localhost` the browser rejects this because:
- `Domain=api.example.com` doesn't match `localhost`
- `SameSite=None` requires `Secure`, and `Secure` is not stored over plain `http://`
- `Path=/api` means the cookie isn't sent to `/` routes

The session evaporates and nothing in the console explains why.

### 3 — The proxy is a black box

Which pattern matched? What status did the backend return? What did it set in `Set-Cookie`? Without logging you're guessing.

---

## The solution

`vite-plugin-proxy-enhancer` layers on top of Vite's proxy, adding:

| | Plain Vite `server.proxy` | `vite-plugin-proxy-enhancer` |
|---|:---:|:---:|
| Multiple `Set-Cookie` headers preserved | ⚠️ depends on path | ✅ always, as `string[]` |
| Rewrite `Domain` / `Path` | ⚠️ `cookieDomainRewrite` only | ✅ |
| Rewrite `SameSite` / `Secure` / `HttpOnly` | ❌ | ✅ |
| `__Host-` / `__Secure-` prefix awareness | ❌ | ✅ |
| Inject cookies into every response | ❌ | ✅ |
| Exclude specific cookies from rewriting | ❌ | ✅ |
| Per-request logging (status, timing, target) | ❌ | ✅ |
| Headers & body in logs | ❌ | ✅ |
| Cookie-rewrite summaries | ❌ | ✅ |
| Global defaults + per-rule overrides | ❌ | ✅ |
| Fail fast with actionable config errors | ❌ | ✅ |
| Warn on overridden `server.proxy` patterns | ❌ | ✅ |

---

## Installation

```bash
npm install -D vite-plugin-proxy-enhancer
# pnpm add -D vite-plugin-proxy-enhancer
# yarn add -D vite-plugin-proxy-enhancer
```

**Requirements:** Vite 5–8, Node.js ≥ 18.

---

## Quick start (30 seconds)

Replace `server.proxy` with the plugin:

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
          cookieRewrite: true, // enable with sensible defaults
        },
      ],
    }),
  ],
});
```

That's it. Requests to `/api/*` are proxied, all `Set-Cookie` headers are preserved as separate fields, and each request is logged in the terminal.

---

## Recipes

### Fix auth cookies for local HTTP development

The most common setup: your backend scopes cookies to its production domain with
`SameSite=None`. On `http://localhost` these cookies are silently dropped.

```ts
proxyEnhancer({
  defaults: {
    changeOrigin: true,
    cookieRewrite: {
      rewriteDomain: true, // strip Domain= so the cookie applies to localhost
      path:          "/",  // widen Path=/api so the cookie covers your whole app
      secure:        false, // don't set Secure — http://localhost isn't HTTPS
      sameSite:      "lax", // replace SameSite=None (which requires Secure)
    },
  },
  proxies: [
    { pattern: "/api", target: "http://localhost:3001" },
  ],
});
```

### Inject a debug feature flag

Set a cookie on every proxied response without touching the backend:

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

Each entry becomes its own `Set-Cookie` header and inherits the rule's
`path`, `secure`, `sameSite`, and `httpOnly` settings.

### Silence health-check noise

```ts
proxyEnhancer({
  logger: { level: "info" },
  proxies: [
    { pattern: "/api/health", target: "http://localhost:3001", log: false }, // silent
    { pattern: "/api",        target: "http://localhost:3001" },             // logged
  ],
});
```

### Debug headers and the cookie diff

```ts
proxyEnhancer({
  logger: {
    level:               "debug",
    logMatches:          true,  // show which pattern matched
    showResponseHeaders: true,  // show Set-Cookie (and other headers)
    logCookieRewrites:   true,  // cookie diff: rewritten / injected / unchanged
    showBody:            true,  // response body (truncated at 16 KB)
  },
  proxies: [
    { pattern: "/api", target: "http://localhost:3001", cookieRewrite: { rewriteDomain: true } },
  ],
});
```

Terminal output:
```
[09:41:14] GET /api/login (/api) → 200 OK 12.4ms ⇢ http://localhost:3001
    res headers
      set-cookie: session=abc; Path=/; SameSite=Lax
      set-cookie: csrf=xyz; Path=/; SameSite=Lax
    cookies rewritten: session, csrf
```

### Proxy WebSocket connections

```ts
{ pattern: "/ws", target: "http://localhost:3002", ws: true }
```

Upgrades are logged with status `101`. Use `rewriteWsOrigin: true` if your
backend validates the `Origin` header.

### Self-signed TLS backend

```ts
{ pattern: "/api", target: "https://localhost:8443", secure: false }
```

### Keep existing `server.proxy` entries

The plugin merges into `server.proxy`, so hand-written entries keep working:

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

The plugin warns at startup if the same pattern appears in both places.

### Per-environment target from `.env`

```ts
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      proxyEnhancer({
        proxies: [{ pattern: "/api", target: env.VITE_API_URL ?? "http://localhost:3001" }],
      }),
    ],
  };
});
```

### Strip cookie prefixes

`__Host-` and `__Secure-` cookies have browser-enforced requirements that break on localhost.

```ts
cookieRewrite: {
  removePrefixes: true, // __Host-session → session
  rewriteDomain: true,
  path: "/",
}
```

Or diagnose programmatically:

```ts
import { parseSetCookieString, checkPrefixRequirements } from "vite-plugin-proxy-enhancer";

const cookie = parseSetCookieString("__Host-session=abc; Path=/; Secure")!;
console.log(checkPrefixRequirements(cookie).violations); // []
```

### Exclude specific cookies

Leave sensitive or third-party cookies (e.g. analytics, payment) exactly as the
backend set them:

```ts
cookieRewrite: {
  rewriteDomain: true,
  path: "/",
  exclude: ["stripe_session", "_ga"],
}
```

---

## Configuration reference

### `proxyEnhancer(options)`

```ts
import type { PluginOptions } from "vite-plugin-proxy-enhancer";

const options: PluginOptions = {
  proxies: [],                            // required — one entry per route
  defaults: { changeOrigin: true },       // merged into every entry
  logger:   { level: "info" },            // global log options
};
```

| Option     | Type | Default | Description |
|------------|------|---------|-------------|
| `proxies`  | `EnhancedProxyOptions[]` | — | Proxy rules. **Required.** |
| `defaults` | `Partial<Omit<EnhancedProxyOptions, "pattern">>` | `{}` | Shared settings merged into every rule (per-entry options win). |
| `logger`   | `LoggerOptions` | see below | Global log config, overridable per rule. |

---

### `EnhancedProxyOptions`

Every standard Vite `ProxyOptions` field (`rewrite`, `bypass`, `ws`, `headers`,
`configure`, `proxyTimeout`, `auth`, `xfwd`, …) passes through to `http-proxy` untouched.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pattern` | `string` | — | Route to match — path prefix (`"/api"`) or RegExp source when prefixed with `^` (`"^/api/.*"`). Must start with `/` or `^`. |
| `target` | `string` | — | Target URL, e.g. `"http://localhost:3001"`. Only `http:` / `https:` are supported. |
| `cookieRewrite` | `CookieRewriteOptions \| boolean` | `false` | Cookie rewriting. `true` = defaults; object = options; `false` = off. |
| `log` | `boolean \| LoggerOptions` | `true` | Per-rule logging. `false` disables; object overrides the global logger. |
| `changeOrigin` | `boolean` | `true` | Rewrite `Host` header to the target. |
| `secure` | `boolean` | `true` | Verify target TLS cert (set `false` for self-signed). |
| `rewrite` | `(path: string) => string` | — | Rewrite the request path. |
| `bypass` | function | — | webpack-style bypass hook. |
| `ws` | `boolean` | `false` | Proxy WebSocket upgrades. |
| `headers` | `object` | — | Extra headers added to proxied requests. |
| `configure` | `(proxy, options) => void` | — | Tune the underlying `http-proxy` server. Composed with (not replacing) the plugin's own handlers. |

---

### `CookieRewriteOptions`

```ts
import type { CookieRewriteOptions } from "vite-plugin-proxy-enhancer";

const cookieRewrite: CookieRewriteOptions = {
  // Domain
  rewriteDomain: true,           // strip Domain= (→ applies to dev origin)
  // removeDomain: true,         // same as above
  // domain: ".example.com",     // replace Domain= with a specific value

  // Path
  path: "/",                     // set Path=/
  // removePath: true,           // remove Path= entirely

  // Flags
  secure:   false,               // strip Secure (smart default for http://)
  httpOnly: true,                // add HttpOnly

  // SameSite
  sameSite: "lax",               // replace SameSite= value
  // removeSameSite: true,       // remove SameSite= entirely

  // Extras
  removePrefixes: true,          // strip __Host- / __Secure- from names
  exclude: ["stripe_session"],   // leave these cookies untouched
  inject: { debug: "on" },       // add cookies to every response
};
```

> **Safety invariants** (always applied on top of your config):
> - `SameSite=None` always keeps `Secure` — browsers reject it otherwise.
> - `__Host-` / `__Secure-` cookies always keep `Secure`.
> - A `__Host-` cookie that conflicts (`Domain` is set or `Path ≠ /`) is
>   auto-de-prefixed to keep it usable.

---

### `LoggerOptions`

```ts
import type { LoggerOptions } from "vite-plugin-proxy-enhancer";

const logger: LoggerOptions = {
  level:               "info",   // "trace"|"debug"|"info"|"warn"|"error"|"silent"
  color:               true,     // ANSI colors (auto-detected by default)
  showRequestHeaders:  false,    // print request headers
  showResponseHeaders: false,    // print response headers (incl. Set-Cookie)
  showBody:            false,    // print response body (max 16 KB, decompressed)
  logMatches:          false,    // show which pattern matched
  logCookieRewrites:   false,    // cookie diff per response
};
```

---

### Config merge order

```
PROXY_DEFAULTS (changeOrigin: true, secure: true)
  < defaults   (plugin-level)
    < entry    (per-pattern)
```

- `cookieRewrite`: `undefined`/`false` → off · `true` → defaults · object → defaults + object (inject maps are merged, exclude is replaced when provided).
- `log`: `undefined`/`true` → global options · `false` → disabled · object → global + object.

---

## Troubleshooting

### The cookie still isn't stored by the browser

Work through this in order:

1. **Is `Domain=` set to the backend's domain?** A cookie for `api.example.com`
   is rejected on `localhost`. Fix: `rewriteDomain: true`.
2. **Is it `SameSite=None`?** It requires `Secure`, and `Secure` cookies are
   rejected over plain `http://`. Fix: `sameSite: "lax", secure: false`.
3. **Is it a `__Host-` or `__Secure-` cookie?** Strict browser requirements apply.
   Fix: `removePrefixes: true`.
4. **Is `Path` too narrow?** A cookie for `Path=/api` isn't sent on `/` routes.
   Fix: `path: "/"`.
5. **Enable the cookie diff** to see exactly what changed:
   ```ts
   logger: { logCookieRewrites: true, showResponseHeaders: true }
   ```

> The plugin emits a one-time warning when it detects a `Secure` cookie being
> forwarded from an HTTP target — it will tell you exactly what to add to your
> config.

### My requests aren't being proxied (404 served by Vite)

- `pattern` must start with `/` or `^`. `"api"` throws at startup with a
  descriptive message.
- Patterns are checked in order; the first match wins. Put specific routes
  (`/api/health`) before broad ones (`/api`).
- Enable `logMatches: true` to confirm what, if anything, matched.

### `ECONNREFUSED` / `502` errors

The target isn't reachable — check the backend is running and the port is correct.

### TLS errors with a self-signed cert

```ts
{ pattern: "/api", target: "https://localhost:8443", secure: false }
```

### WebSocket not connecting

Set `ws: true` on the rule. The target should be an `http://` or `https://` URL — the upgrade happens transparently. If the backend checks the `Origin` header, also set `rewriteWsOrigin: true`.

### Logs aren't appearing

- Check `logger.level` (default `"info"`). Set `"debug"` for more.
- Check the rule doesn't have `log: false`.
- If output looks garbled in CI: `logger: { color: false }`.

### Startup error with `[proxy-enhancer]` prefix

Config validation failed. The message names the offending entry and explains what's wrong — missing `proxies`, an invalid pattern, a bad target URL, etc.

---

## How `Set-Cookie` preservation works

`Set-Cookie` is HTTP's designated exceptional header: per RFC 6265, each cookie
must be in its own header field and **must not** be comma-joined. The plugin
treats it as a pure `string[]` end-to-end:

1. **Extract** — reads every `set-cookie` key (case-insensitive) into individual cookie strings.
2. **Rewrite** — each cookie is parsed, rewritten, and re-serialized independently.
3. **Write back** — assigned as a fresh `string[]`; Node emits one `Set-Cookie:` line per element.

---

## TypeScript

Fully typed with strict `noImplicitAny`. Everything is importable:

```ts
import { proxyEnhancer } from "vite-plugin-proxy-enhancer";

import type {
  PluginOptions,
  EnhancedProxyOptions,
  CookieRewriteOptions,
  LoggerOptions,
  LogLevel,
  ProxyOptions,
} from "vite-plugin-proxy-enhancer";
```

Low-level cookie utilities are also exported if you need them:

```ts
import {
  parseSetCookieString,
  rewriteCookieString,
  rewriteResponseSetCookies,
  injectResponseCookies,
  checkPrefixRequirements,
  createLogger,
  resolveConfig,
} from "vite-plugin-proxy-enhancer";
```

---

## Try the example

A fully runnable demo is in [`example/`](./example) — a mock backend that
deliberately misbehaves, the plugin config that fixes it, and an interactive
browser page.

```bash
# 1. Install and build the plugin
npm install && npm run build

# 2. Start the mock backend (terminal 1)
node example/mock-api.mjs

# 3. Start the Vite dev server (terminal 2)
npx vite --config example/vite.config.ts

# 4. Open http://localhost:5173 and click the buttons
```

The demo shows:
- Three production-style misbehaving cookies getting rewritten for localhost
- The cookie round-trip (`/api/login` → `/api/me`)
- Cookie injection (`x-debug=on` added to every response)
- WebSocket proxying

---

## License

[MIT](./LICENSE)
