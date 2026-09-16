import type { ProxyOptions } from "vite";
import type { CookieRewriteRule } from "./cookie";

// ─── Logger ────────────────────────────────────────────────────

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

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
  /** Log matched proxy entries on request. @default false */
  logMatches?: boolean;
  /** Log cookie rewrite operations. @default false */
  logCookieRewrites?: boolean;
}

// ─── Cookie Rewrite ────────────────────────────────────────────

export interface CookieRewriteOptions extends CookieRewriteRule {
  /** Legacy shorthand: rewrite the Domain attribute. @default false */
  rewriteDomain?: boolean;
  /** Legacy shorthand: rewrite the Path attribute. @default false */
  rewritePath?: boolean;
  /** Additional cookies to inject into every proxied response. @default {} */
  inject?: Record<string, string>;
}

// ─── Proxy Entry ───────────────────────────────────────────────

export interface EnhancedProxyOptions {
  /** URL path pattern to match, e.g. `"/api"`. */
  pattern: string;
  /** Target server URL, e.g. `"http://localhost:3001"`. */
  target: string;
  /** Rewrite the request path before proxying. */
  rewrite?: (path: string) => string;
  /** Change the host header to the target. @default true */
  changeOrigin?: boolean;
  /** Forward SSL requests to the target. @default true */
  secure?: boolean;
  /** Access the underlying http-proxy instance for advanced config. */
  configure?: (
    proxy: Record<string, unknown>,
    options: ProxyOptions,
  ) => void;
  /** Cookie rewriting configuration. Pass `true` to enable with defaults. */
  cookieRewrite?: CookieRewriteOptions | boolean;
  /** Enable/disable logging for this rule, or override the global logger options. @default true */
  log?: boolean | LoggerOptions;
}

// ─── Plugin Options ────────────────────────────────────────────

export interface PluginOptions {
  /** Proxy entries to enhance. */
  proxies: EnhancedProxyOptions[];
  /** Global defaults merged into every proxy entry. */
  defaults?: Partial<Omit<EnhancedProxyOptions, "pattern">>;
  /** Logger configuration. */
  logger?: LoggerOptions;
}

// ─── Internal / Resolved ───────────────────────────────────────

export interface ResolvedProxyLog {
  enabled: boolean;
  options: Required<LoggerOptions>;
}

export type ResolvedProxyOptions = Required<
  Pick<EnhancedProxyOptions, "pattern" | "target">
> &
  Omit<EnhancedProxyOptions, "pattern" | "target"> & {
    changeOrigin: boolean;
    secure: boolean;
    log: ResolvedProxyLog;
  };

export interface ResolvedConfig {
  proxies: ResolvedProxyOptions[];
  logger: Required<LoggerOptions>;
}
