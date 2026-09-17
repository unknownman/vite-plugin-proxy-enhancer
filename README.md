# vite-plugin-proxy-enhancer

Enhance the [Vite](https://vitejs.dev) dev-server proxy with cookie rewriting, per-proxy defaults, WebSocket support, and colorful request logging — while keeping 100% compatibility with Vite's native `server.proxy` options.

## Why?

Proxying a backend through the Vite dev server is quick, but real requests hit real problems:

- **Auth cookies break.** Your API sets `Set-Cookie: session=abc; Domain=api.example.com; Path=/api`. The browser is on `localhost:5173`, the domain doesn't match, and the cookie is silently dropped — so the next request has no session. In a browser, this fails silently; in dev, it wastes hours.
- **`sameSite` / `secure` fights.** A `SameSite=None` cookie *must* be `Secure`, `__Host-` cookies *must* set `Path=/` and no `Domain`. Backends often get this wrong, or the flags are valid for production but fatal for `http://localhost` — either way the cookie never sticks.
- **Multiple `Set-Cookie` headers get mangled.** Proxies that treat `set-cookie` as a single string collapse several cookies into one invalid header. This plugin keeps each one separate.
- **You can't see what the proxy is doing.** Requests fail against the backend with no feedback from Vite's terse proxy errors.

`vite-plugin-proxy-enhancer` fixes these by layering cookie rewriting and logging on top of Vite's own proxy middleware, one drop-in plugin.

## Features

- 🍪 **Cookie rewriting** — rewrite or strip `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite`, and `__Host-`/`__Secure-` prefixes on proxied `Set-Cookie` responses, and inject extra cookies.
- 🧩 **Global defaults** — shared settings for every rule, overridden per entry.
- 🔧 **Full Vite compatibility** — every native `ProxyOptions` field (`rewrite`, `bypass`, `ws`, `headers`, `configure`, …) passes through untouched.
- 🔌 **HTTP + WebSocket proxy** — normal requests and `ws:` upgrades both log correctly; `rewriteWsOrigin` is supported out of the box.
- 📝 **Granular logging** — method, URL, status, duration and target per request; opt into headers, body, matched pattern, and cookie-rewrite summaries.
- 🛡️ **Fails loud, fails safe** — invalid config throws a descriptive error at startup; runtime hiccups (e.g. one unparseable cookie) are caught and logged without killing the proxy.

## Installation

```bash
npm install -D vite-plugin-proxy-enhancer
# or
pnpm add -D vite-plugin-proxy-enhancer
# or
yarn add -D vite-plugin-proxy-enhancer
```

## Quick start

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { proxyEnhancer } from "vite-plugin-proxy-enhancer";

export default defineConfig({
  plugins: [
    proxyEnhancer({
      proxies: [
        { pattern: "/api/**", target: "http://localhost:3001" },
      ],
    }),
  ],
});
```

That's a drop-in replacement for `server.proxy` — requests to `/api/...` forward to `http://localhost:3001` with `changeOrigin` on, and each request is logged out:

```
  [09:41:13] INFO  Configuring 1 proxy entry
  [09:41:14] GET /api/users → 200 OK 42.1ms ⇢ http://localhost:3001
```

## Advanced usage

```ts
proxyEnhancer({
  // Merged into every entry (per-entry options win — see "Config resolution").
  defaults: {
    changeOrigin: true,
    cookieRewrite: true, // enable with sensible defaults everywhere
  },
  logger: {
    level: "info",
    logMatches: true,          // show which pattern matched
    logCookieRewrites: true,   // announce injected/rewritten cookies
  },
  proxies: [
    {
      pattern: "/api/**",
      target: "https://api.example.com",
      // Native Vite options still work:
      rewrite: (path) => path.replace(/^\/api/, ""),
      ws: true,                            // pass through WebSockets
      cookieRewrite: {
        rewriteDomain: true,               // strip Domain so cookies apply to localhost
        secure: false,                     // don't force Secure over http://
        path: "/",                         // cookie now valid across the whole app
        exclude: ["stripe_session"],       // leave certain cookies alone
      },
    },
    {
      pattern: "/auth",
      target: "https://auth.example.com",
      log: false,                          // silence noisy endpoint
    },
    {
      pattern: "^/graphql$",               // regex pattern (leading "^")
      target: "http://localhost:4000",
      headers: { "x-proxied-by": "vite" },
    },
  ],
});
```

## Common recipes

### 1. Fix broken auth/session cookies in dev

Backends that scope cookies to their real domain produce cookies the browser rejects on `localhost`. Strip the `Domain` attribute and slim the cookie down to what the dev server can use:

```ts
cookieRewrite: {
  rewriteDomain: true,   // remove "Domain=api.example.com"
  path: "/",             // valid for the whole app, not just /api
  secure: false,         // ok on http://localhost
  httpOnly: true,        // keep anything the backend sent (no-op here, just explicit)
}
```

`rewriteDomain` is a shorthand for `removeDomain: true`. If you need a *specific* domain instead, set `domain` explicitly.

### 2. `SameSite` / `Secure` conflicts

Backends issuing `SameSite=None` without `Secure` (or `SameSite=Strict` when the proxy is cross-site) silently lose cookies. Nudge them into shape:

```ts
cookieRewrite: {
  sameSite: "None",
  secure: true,          // SameSite=None REQUIRES Secure
  path: "/",
}
```

> Note: `Secure` cookies won't be stored by the browser if you're visiting the dev server over plain `http://` (the usual case). In that scenario prefer `sameSite: "Lax"` instead of `"None"`.

### 3. Diagnose prefixed cookies

`__Host-` and `__Secure-` cookies have strict browser-enforced requirements. Use the exported `checkPrefixRequirements` helper to find out why one never sticks:

```ts
import { parseSetCookieString, checkPrefixRequirements } from "vite-plugin-proxy-enhancer";

const cookie = parseSetCookieString("__Host-session=abc; Path=/; Secure")!;
console.log(checkPrefixRequirements(cookie).violations); // []
```

### 4. Inject cookies into every response

```ts
cookieRewrite: {
  inject: {
    feature_flag: "on",
    "seen-tutorial": "yes",
  },
}
```

Injected cookies inherit the rule's `domain`, `path`, `secure`, `httpOnly`, and `sameSite` settings.

### 5. Proxy WebSockets

```ts
{ pattern: "/ws", target: "ws://localhost:3002", ws: true }
```

Upgrades are logged with their `101` status, and `rewriteWsOrigin` passes through if you need it for auth handshakes.

### 6. Deep-dive an endpoint

```ts
logger: {
  showRequestHeaders: true,
  showResponseHeaders: true,
  showBody: true,     // body is truncated to 2000 bytes in the log
  logCookieRewrites: true,
}
```

Sample output:

```
  [09:41:14] GET /api/users (/api/**) → 200 OK 112.9ms ⇢ http://localhost:3001
      req headers
      host: localhost:5173
      cookie: session=abc; theme=dark
    res headers
      content-type: application/json
    body
      {"users":[{"id":1,"name":"Ada"}]}
[09:41:14] INFO     cookies rewritten: session
```

### 7. Combine with Vite's native `server.proxy`

You can keep existing `server.proxy` entries and use the plugin for a few enhanced routes. The plugin warns about unmanaged patterns so you don't accidentally double-define one.

## Configuration

### `PluginOptions`

| Option     | Type                              | Default | Description                                        |
| ---------- | --------------------------------- | ------- | -------------------------------------------------- |
| `proxies`  | `EnhancedProxyOptions[]`          | —       | Proxy rules to create. **Required.**               |
| `defaults` | `Partial<EnhancedProxyOptions>`   | `{}`    | Settings merged into every rule (except `pattern`). |
| `logger`   | `LoggerOptions`                   | see below | Global log options.                              |

### `EnhancedProxyOptions`

`pattern` and `target` are plugin-specific; **every other field is a standard Vite `ProxyOptions`/http-proxy option** and passes through untouched.

| Option           | Type                                  | Default   | Description                                              |
| ---------------- | ------------------------------------- | --------- | -------------------------------------------------------- |
| `pattern`        | `string`                              | —         | Path to match, e.g. `"/api"`, `"/api/**"` or `"^/api/.*"` (regex when prefixed with `^`). |
| `target`         | `string`                              | —         | Target server, e.g. `"http://localhost:3001"` or `"https://api.example.com"`. |
| `cookieRewrite`  | `CookieRewriteOptions \| boolean`     | `false`   | Enable cookie rewriting. `true` = sensible defaults; object = options; `false` = off. |
| `log`            | `boolean \| LoggerOptions`            | `true`    | Per-rule logging. `false` disables; object overrides global `logger`. |
| `changeOrigin`   | `boolean`                             | `true`    | Rewrite the `Host` header to the target. |
| `secure`         | `boolean`                             | `true`    | Verify the target's TLS certificate. |
| `rewrite`        | `(path: string) => string`            | —         | Rewrite the request path before proxying (native Vite). |
| `bypass`         | `(req, res, options) => void \| …`    | —         | webpack-dev-server-style bypass function (native Vite). |
| `ws`             | `boolean`                             | `false`   | Proxy WebSocket upgrades. |
| `rewriteWsOrigin`| `boolean`                             | —         | Rewrite the WebSocket `Origin` header to the target. |
| `headers`        | `object`                              | —         | Headers to inject on proxied requests. |
| `configure`      | `(proxy, options) => void`            | —         | Tune the underlying `http-proxy` server. The plugin runs your callback first, then attaches its own handlers. |
| `proxyTimeout` / `timeout`, `xfwd`, `auth`, `followRedirects`, `preserveHeaderKeyCase`, … | —   | —   | All remaining http-proxy server options are supported. |
| `cookieDomainRewrite` / `cookiePathRewrite` | —    | —    | http-proxy's own (cruder) cookie rewrite options still work; for anything serious use `cookieRewrite`. |

### `CookieRewriteOptions`

| Option             | Type                    | Default | Description                                                 |
| ------------------ | ----------------------- | ------- | ----------------------------------------------------------- |
| `rewriteDomain`    | `boolean`               | `false` | Deprecated shorthand for `removeDomain` (strip `Domain`).  |
| `removeDomain`     | `boolean`               | `false` | Remove the `Domain` attribute.                              |
| `domain`           | `string`                | —       | Replace the `Domain` attribute, e.g. `".example.com"`.      |
| `rewritePath`      | `boolean`               | `false` | Deprecated shorthand for `path: "/"`.                      |
| `removePath`       | `boolean`               | `false` | Remove the `Path` attribute.                               |
| `path`             | `string`                | —       | Replace the `Path` attribute, e.g. `"/"`.                  |
| `secure`           | `boolean`               | `false` | Ensure the `Secure` flag is set.                           |
| `removeSecure`     | `boolean`               | `false` | Remove the `Secure` flag.                                  |
| `httpOnly`         | `boolean`               | `false` | Ensure the `HttpOnly` flag is set.                         |
| `removeHttpOnly`   | `boolean`               | `false` | Remove the `HttpOnly` flag.                                |
| `sameSite`         | `"Strict" \| "Lax" \| "None"` | —    | Replace the `SameSite` attribute.                          |
| `removeSameSite`   | `boolean`               | `false` | Remove the `SameSite` attribute.                           |
| `removePrefixes`   | `boolean`               | `false` | Strip `__Host-` / `__Secure-` prefixes from cookie names.   |
| `exclude`          | `string[]`              | `[]`    | Cookie names to leave completely untouched.                |
| `inject`           | `Record<string, string>` | `{}`  | Extra cookies set on every proxied response.               |

`cookieRewrite: true` enables rewriting with defaults: no attributes changed, no exclusions, no injection — inspect or log real traffic (`logCookieRewrites`) before adding rules.

### `LoggerOptions`

| Option               | Type               | Default   | Description                                    |
| -------------------- | ------------------ | --------- | ---------------------------------------------- |
| `level`              | `"trace" \| "debug" \| "info" \| "warn" \| "error" \| "silent"` | `"info"` | Verbosity. Accounts for plugin notices and request logs. |
| `color`              | `boolean`          | auto      | ANSI colors (autodetected).                    |
| `showRequestHeaders` | `boolean`          | `false`   | Print proxied request headers.                 |
| `showResponseHeaders`| `boolean`          | `false`   | Print proxied response headers.                |
| `showBody`           | `boolean`          | `false`   | Print the response body (truncated at 2000 bytes). |
| `logMatches`         | `boolean`          | `false`   | Show the matched pattern on each request line. |
| `logCookieRewrites`  | `boolean`          | `false`   | Summarize cookies injected/rewritten/added/unchanged per response. |

## Config resolution

Merging follows, highest precedence last:

```
PROXY_DEFAULTS   (changeOrigin: true, secure: true)
  < defaults     (plugin-level)
  < entry        (per-pattern)
```

- `cookieRewrite`: `undefined`/`false` → disabled · `true` → defaults · object → defaults + object.
- `log`: `undefined`/`true` → enabled with global options · `false` → disabled · object → global + object.

## Error handling

- **At startup**, options are validated. Bad patterns (must start with `/` or `^`), invalid/missing `target`, non-`http(s)` targets, malformed entries, and a missing `proxies` array all raise an error prefixed with `[proxy-enhancer]`:

  ```
  [proxy-enhancer] Invalid configuration: proxy[0].pattern "api" will never match a request. Patterns are matched against URL paths, so they must start with "/" (e.g. "/api" or "/api/**") or "^" for a RegExp (e.g. "^/api/.*").
  ```

- **At runtime**, a failure in one request never breaks the proxy. For example, an unparseable `Set-Cookie` header logs:

  ```
  10:02:11 WARN  cookie rewrite failed for GET /api/users: <reason>
  ```

- **Conflicts** with patterns you also defined under Vite's native `server.proxy` trigger a warning at config time.

## TypeScript

Fully typed, strict, no `any` in the public API. Import any of the options or helpers:

```ts
import { proxyEnhancer, resolveConfig, createLogger, rewriteSetCookieHeaders } from "vite-plugin-proxy-enhancer";
import type { PluginOptions, EnhancedProxyOptions, CookieRewriteOptions, LoggerOptions } from "vite-plugin-proxy-enhancer";
```

## License

[MIT](./LICENSE)