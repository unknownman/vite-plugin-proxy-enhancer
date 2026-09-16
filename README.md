# vite-plugin-proxy-enhancer

Enhance the [Vite](https://vitejs.dev) dev server proxy with path rewriting, cookie domain/secure rewriting, per-proxy defaults, and granular logging.

## Features

- ⚡ **Zero-config** — drop-in replacement for Vite's `server.proxy`
- 🍪 **Cookie rewriting** — rewrite `domain`, `path`, and `Secure` flags on proxied responses
- 🧩 **Global defaults** — apply shared settings to every proxy entry, override per-entry
- 🔧 **Path rewriting** — rewrite proxied request paths with a simple function
- 📝 **Granular logging** — control log level and verbosity
- 🛡️ **Runtime validation** — clear, actionable errors on misconfiguration

## Installation

```bash
npm install -D vite-plugin-proxy-enhancer
# or
pnpm add -D vite-plugin-proxy-enhancer
# or
yarn add -D vite-plugin-proxy-enhancer
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { proxyEnhancer } from "vite-plugin-proxy-enhancer";

export default defineConfig({
  plugins: [
    proxyEnhancer({
      // Global defaults merged into every proxy entry
      defaults: {
        changeOrigin: true,
        cookieRewrite: true,
      },
      logger: {
        level: "warn",
        logMatches: true,
      },
      proxies: [
        {
          pattern: "/api/**",
          target: "http://localhost:3001",
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        {
          pattern: "/auth",
          target: "https://auth.example.com",
          cookieRewrite: {
            rewriteDomain: true,
            domain: ".example.com",
            secure: true,
            path: "/",
            exclude: ["_session"],
          },
        },
      ],
    }),
  ],
});
```

## Configuration

### `PluginOptions`

| Option     | Type                             | Default       | Description                                   |
| ---------- | -------------------------------- | ------------- | --------------------------------------------- |
| `proxies`  | `EnhancedProxyOptions[]`         | **required**  | Proxy entries to enhance.                     |
| `defaults` | `Partial<EnhancedProxyOptions>`  | `{}`          | Global defaults merged into every entry.      |
| `logger`   | `LoggerOptions`                  | see below     | Logging configuration.                        |

### `EnhancedProxyOptions`

| Option          | Type                                        | Default  | Description                                              |
| --------------- | ------------------------------------------- | -------- | -------------------------------------------------------- |
| `pattern`       | `string`                                    | **required** | URL path pattern to match, e.g. `"/api"`.            |
| `target`        | `string`                                    | **required** | Target server URL, e.g. `"http://localhost:3001"`.    |
| `changeOrigin`  | `boolean`                                   | `true`   | Change the `Host` header to the target.                  |
| `secure`        | `boolean`                                   | `true`   | Forward SSL requests to the target.                      |
| `rewrite`       | `(path: string) => string`                  | —        | Rewrite the request path before proxying.                |
| `cookieRewrite` | `CookieRewriteOptions \| boolean`          | —        | Cookie rewriting. Pass `true` to enable with defaults.   |
| `configure`     | `(proxy, options) => void`                  | —        | Access the underlying `http-proxy` instance.             |

### `CookieRewriteOptions`

| Option          | Type                  | Default | Description                                               |
| --------------- | --------------------- | ------- | --------------------------------------------------------- |
| `rewriteDomain` | `boolean`             | `false` | Rewrite the cookie `domain` attribute.                    |
| `domain`        | `string`              | `""`    | Custom domain to inject. Implies `rewriteDomain`.         |
| `secure`        | `boolean`             | `false` | Add the `Secure` flag to cookies.                         |
| `rewritePath`   | `boolean`             | `false` | Rewrite the cookie `path` attribute.                      |
| `path`          | `string`              | `""`    | Custom path to set. Implies `rewritePath`.                |
| `inject`        | `Record<string,string>` | `{}`   | Additional cookies injected into every proxied response.  |
| `exclude`       | `string[]`            | `[]`    | Cookie names skipped during rewriting.                    |

### `LoggerOptions`

| Option               | Type                       | Default  | Description                                  |
| -------------------- | -------------------------- | -------- | -------------------------------------------- |
| `level`              | `"info" \| "warn" \| "error" \| "silent"` | `"info"` | Log level.                                   |
| `logMatches`         | `boolean`                  | `false`  | Log matched proxy entries on request.        |
| `logCookieRewrites`  | `boolean`                  | `false`  | Log cookie rewrite operations.               |

## Config Resolution

Global `defaults` are merged into every proxy entry, and per-entry options always win:

```
PROXY_DEFAULTS < defaults < entry
```

`cookieRewrite` accepts `true` (enables with defaults), `false` (disables), or a full
`CookieRewriteOptions` object.

## TypeScript

Fully typed. Strict TypeScript throughout — no `any` in the public API. All interfaces are
exported for consumers:

```ts
import type {
  PluginOptions,
  EnhancedProxyOptions,
  CookieRewriteOptions,
  LoggerOptions,
} from "vite-plugin-proxy-enhancer";
```

## License

[MIT](./LICENSE)