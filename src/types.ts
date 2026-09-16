import type { ProxyOptions } from "vite";

// ─── Logger ────────────────────────────────────────────────────

export type LogLevel = "info" | "warn" | "error" | "silent";

export interface LoggerOptions {
  /** Log level for plugin output. @default "info" */
  level?: LogLevel;
  /** Log matched proxy entries on request. @default false */
  logMatches?: boolean;
  /** Log cookie rewrite operations. @default false */
  logCookieRewrites?: boolean;
}

// ─── Cookie Rewrite ────────────────────────────────────────────

export interface CookieRewriteOptions {
  /** Rewrite the domain attribute on cookies. @default false */
  rewriteDomain?: boolean;
  /** Custom domain to inject into cookies. When set, `rewriteDomain` is implied. */
  domain?: string;
  /** Add the Secure flag to cookies. @default false */
  secure?: boolean;
  /** Rewrite the path attribute on cookies. @default false */
  rewritePath?: boolean;
  /** Custom path to set on cookies. When set, `rewritePath` is implied. */
  path?: string;
  /** Additional cookies to inject into every proxied response. @default {} */
  inject?: Record<string, string>;
  /** Cookie names to skip during rewriting. @default [] */
  exclude?: string[];
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

export type ResolvedProxyOptions = Required<
  Pick<EnhancedProxyOptions, "pattern" | "target">
> &
  Omit<EnhancedProxyOptions, "pattern" | "target"> & {
    changeOrigin: boolean;
    secure: boolean;
  };

export interface ResolvedConfig {
  proxies: ResolvedProxyOptions[];
  logger: Required<LoggerOptions>;
}
