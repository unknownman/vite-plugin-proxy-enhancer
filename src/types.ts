import type { ProxyOptions } from "vite";
import type { CookieRewriteRule } from "./cookie";

// Re-export Vite's proxy types through our public API.
export type { ProxyOptions } from "vite";

// ─── Logger ────────────────────────────────────────────────────

/** Log levels, ordered from most to least verbose. `"silent"` disables all output. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

/** Options controlling the plugin's log output. */
export interface LoggerOptions {
  /** Log level for plugin output. @default "info" */
  level?: LogLevel;
  /** Enable/disable ANSI colors. Defaults to auto-detection. @default true */
  color?: boolean;
  /** Show request headers for proxied requests. @default false */
  showRequestHeaders?: boolean;
  /** Show response headers for proxied requests. @default false */
  showResponseHeaders?: boolean;
  /** Show the response body for proxied requests. @default false */
  showBody?: boolean;
  /** Show the matched pattern in each request log entry. @default false */
  logMatches?: boolean;
  /** Log cookie rewrite operations (injected, modified, and untouched cookies). @default false */
  logCookieRewrites?: boolean;
}

// ─── Cookie Rewrite ────────────────────────────────────────────

/** User-facing cookie rewrite configuration for a single proxy rule. */
export interface CookieRewriteOptions extends CookieRewriteRule {
  /** Additional cookies to inject into every proxied response. @default {} */
  inject?: Record<string, string>;
}

// ─── Proxy Entry ───────────────────────────────────────────────

/**
 * One enhanced proxy rule. Supports every native Vite {@link ProxyOptions} field
 * (`rewrite`, `bypass`, `ws`, `headers`, `configure`, …) plus the plugin's
 * `pattern` / `target` requirements and cookie/logging enhancements.
 */
export interface EnhancedProxyOptions extends Omit<ProxyOptions, "target"> {
  /** URL path pattern to match, e.g. `"/api"`. Supports globs (`"/api/**"`) and,
   *  when prefixed with `^`, a RegExp source (`"^/api/.*"`). */
  pattern: string;
  /** Target server URL, e.g. `"http://localhost:3001"`. */
  target: string;
  /** Cookie rewriting configuration. Pass `true` to enable with defaults. */
  cookieRewrite?: CookieRewriteOptions | boolean;
  /** Enable/disable logging for this rule, or override the global logger options. @default true */
  log?: boolean | LoggerOptions;
}

// ─── Plugin Options ────────────────────────────────────────────

/** The plugin's constructor options. */
export interface PluginOptions {
  /** Proxy entries to enhance. */
  proxies: EnhancedProxyOptions[];
  /** Global defaults merged into every proxy entry. */
  defaults?: Partial<Omit<EnhancedProxyOptions, "pattern">>;
  /** Global logger configuration merged into every entry's logger. */
  logger?: LoggerOptions;
}

// ─── Internal / Resolved ───────────────────────────────────────

/** Fully-resolved logging state for a proxy rule. */
export interface ResolvedProxyLog {
  /** Whether request logging is active for this rule. */
  enabled: boolean;
  /** Effective logger options (globals merged with any per-entry overrides). */
  options: Required<LoggerOptions>;
}

/**
 * A proxy rule after validation and default-merging. Values are guaranteed
 * (`changeOrigin`/`secure` are always booleans, `cookieRewrite` is always an
 * object or `false`, `log` is always a {@link ResolvedProxyLog}).
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

/** The result of {@link resolveConfig}. */
export interface ResolvedConfig {
  /** Fully-resolved, validated proxy rules. */
  proxies: ResolvedProxyOptions[];
  /** Effective global logger options. */
  logger: Required<LoggerOptions>;
}
