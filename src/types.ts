import type { ProxyOptions } from "vite";
import type { CookieRewriteRule } from "./cookie";

// Re-export Vite's proxy types through our public API.
export type { ProxyOptions } from "vite";

// ─── Logger ────────────────────────────────────────────────────

/**
 * Log levels, ordered from most to least verbose.
 *
 * A logger prints a message when its level is at or above the configured
 * threshold, so `"info"` prints `info`, `warn`, and `error` while suppressing
 * `debug` and `trace`. `"silent"` disables all output.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

/**
 * Options controlling the plugin's log output.
 *
 * Set these globally via {@link PluginOptions.logger} and override them per rule
 * with {@link EnhancedProxyOptions.log}. Any unset option falls back to
 * {@link LOGGER_DEFAULTS}.
 *
 * @example
 * // Verbose diagnostics while debugging a single route
 * proxyEnhancer({
 *   logger: { level: "debug", logMatches: true, showRequestHeaders: true },
 *   proxies: [{ pattern: "/api", target: "http://localhost:3001" }],
 * });
 */
export interface LoggerOptions {
  /**
   * Minimum level to print. Messages below it are dropped.
   * @default "info"
   */
  level?: LogLevel;
  /**
   * Enable ANSI colors. When unset, colors are auto-detected from the terminal
   * (and disabled automatically when output is redirected to a file/pipe).
   * @default true
   */
  color?: boolean;
  /**
   * Print the headers of each proxied request.
   * @default false
   */
  showRequestHeaders?: boolean;
  /**
   * Print the headers of each proxied response.
   * @default false
   */
  showResponseHeaders?: boolean;
  /**
   * Print the response body, truncated to 2000 bytes so large payloads don't
   * flood the console.
   * @default false
   */
  showBody?: boolean;
  /**
   * Show which proxy `pattern` matched on each request line. Useful when several
   * rules could match the same URL.
   * @default false
   */
  logMatches?: boolean;
  /**
   * Summarize cookie rewriting per response — which cookies were rewritten,
   * injected, added, or left unchanged. The fastest way to see whether cookie
   * rules are doing what you expect.
   * @default false
   */
  logCookieRewrites?: boolean;
}

// ─── Cookie Rewrite ────────────────────────────────────────────

/**
 * User-facing cookie rewrite configuration for a single proxy rule.
 *
 * Extends {@link CookieRewriteRule} (the declarative attribute rules) with
 * {@link inject}. Safe for cross-origin development: rewriting is validated so it
 * can never emit a cookie a browser would reject (see `rewriteCookie`).
 *
 * @example
 * // Localhost development: strip the production domain, scope to the app, and
 * // add a debug flag to every proxied response.
 * const cookieRewrite: CookieRewriteOptions = {
 *   rewriteDomain: true,
 *   path: "/",
 *   sameSite: "Lax",
 *   exclude: ["stripe_session"],
 *   inject: { feature_flag: "on" },
 * };
 */
export interface CookieRewriteOptions extends CookieRewriteRule {
  /**
   * Extra cookies to inject into every proxied response.
   *
   * Each entry becomes its own `Set-Cookie` header (RFC 6265) and inherits the
   * rule's `domain` / `path` / `secure` / `httpOnly` / `sameSite` settings.
   *
   * @example `{ feature_flag: "on", "seen-tutorial": "yes" }`
   * @default {}
   */
  inject?: Record<string, string>;
}

// ─── Proxy Entry ───────────────────────────────────────────────

/**
 * One enhanced proxy rule.
 *
 * Inherits every native Vite {@link ProxyOptions} field — `rewrite`, `bypass`,
 * `ws`, `headers`, `configure`, `proxyTimeout`, `auth`, `xfwd`, … — all of which
 * pass through untouched. On top of that it adds the plugin's `pattern` /
 * `target` requirements plus optional `cookieRewrite` and `log` enhancements.
 *
 * @example
 * const rule: EnhancedProxyOptions = {
 *   pattern: "/api",
 *   target: "https://api.example.com",
 *   cookieRewrite: { rewriteDomain: true, path: "/" },
 *   log: { level: "debug" },
 *   ws: true,
 *   rewrite: (path) => path.replace(/^\/api/, ""),
 *   headers: { "x-proxied-by": "vite" },
 * };
 */
export interface EnhancedProxyOptions extends Omit<ProxyOptions, "target"> {
  /**
   * Route to match, evaluated against the request URL path using the same rules
   * as Vite's `server.proxy`.
   *
   * - Path prefix (plain string): `"/api"` matches `/api`, `/api/`, and
   *   `/api/users`.
   * - RegExp source when prefixed with `^`: `"^/api(/|$)"` or `"^/api/.*"`.
   *
   * Note this is a prefix, not a glob — `"/api/**"` would only match URLs that
   * literally start with `/api/**`. Must start with `/` or `^`, otherwise it can
   * never match and the plugin throws at startup.
   */
  pattern: string;
  /**
   * Target server URL, e.g. `"http://localhost:3001"` or
   * `"https://api.example.com"`.
   *
   * Only `http:` and `https:` targets are supported (WebSocket upgrades are
   * forwarded transparently through them).
   */
  target: string;
  /**
   * Cookie rewriting configuration.
   *
   * - `true` — enable with defaults (rewrite enabled, no attributes changed)
   * - object — enable with the given {@link CookieRewriteOptions}
   * - omitted / `false` — disabled
   * @default false
   */
  cookieRewrite?: CookieRewriteOptions | boolean;
  /**
   * Logging for this rule.
   *
   * - `true` / omitted — enabled with the global {@link PluginOptions.logger} options
   * - `false` — disable logging for this rule
   * - object — enabled, with these {@link LoggerOptions} merged over the global ones
   * @default true
   */
  log?: boolean | LoggerOptions;
}

// ─── Plugin Options ────────────────────────────────────────────

/**
 * The plugin's constructor options, passed to `proxyEnhancer()`.
 *
 * @example
 * proxyEnhancer({
 *   defaults: { changeOrigin: true, cookieRewrite: true },
 *   logger: { level: "info", logMatches: true },
 *   proxies: [
 *     { pattern: "/api", target: "http://localhost:3001" },
 *     { pattern: "/ws", target: "http://localhost:3002", ws: true, log: false },
 *   ],
 * });
 */
export interface PluginOptions {
  /**
   * Proxy rules to create.
   *
   * Each entry is merged into Vite's `server.proxy` under its `pattern`. Entries
   * you define yourself under `server.proxy` keep working; the plugin warns if
   * the same pattern is defined in both places.
   *
   * **Required** — an empty array is allowed but logs a warning at startup.
   */
  proxies: EnhancedProxyOptions[];
  /**
   * Settings merged into every rule before that rule's own options.
   *
   * `pattern` is intentionally excluded (each rule defines its own). Per-entry
   * options always win, so `defaults` is the place for shared options like
   * `changeOrigin` or a baseline `cookieRewrite`.
   * @default {}
   */
  defaults?: Partial<Omit<EnhancedProxyOptions, "pattern">>;
  /**
   * Global logger configuration, merged into every rule's logger.
   * @see {@link LoggerOptions}
   */
  logger?: LoggerOptions;
}

// ─── Internal / Resolved ───────────────────────────────────────

/**
 * Fully-resolved logging state for a proxy rule, produced by {@link resolveConfig}.
 */
export interface ResolvedProxyLog {
  /** Whether request logging is active for this rule. */
  enabled: boolean;
  /** Effective logger options (globals merged with any per-entry overrides). */
  options: Required<LoggerOptions>;
}

/**
 * A proxy rule after validation and default-merging, produced by
 * {@link resolveConfig}.
 *
 * Unlike {@link EnhancedProxyOptions}, every value is guaranteed present:
 * `changeOrigin` and `secure` are booleans, `cookieRewrite` is an options object
 * or `false`, and `log` is a {@link ResolvedProxyLog}.
 */
export type ResolvedProxyOptions = Required<
  Pick<EnhancedProxyOptions, "pattern" | "target">
> &
  Omit<EnhancedProxyOptions, "pattern" | "target"> & {
    changeOrigin: boolean;
    secure: boolean;
    cookieRewrite: CookieRewriteOptions | false;
    log: ResolvedProxyLog;
  };

/**
 * The result of {@link resolveConfig}: validated rules plus the effective global
 * logger options.
 */
export interface ResolvedConfig {
  /** Fully-resolved, validated proxy rules. */
  proxies: ResolvedProxyOptions[];
  /** Effective global logger options. */
  logger: Required<LoggerOptions>;
}
