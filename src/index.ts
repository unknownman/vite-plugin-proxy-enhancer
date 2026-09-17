// Public API of vite-plugin-proxy-enhancer.

// Plugin & configuration.
export { proxyEnhancer } from "./plugin";
export { resolveConfig } from "./config";

// Logging.
export { createLogger, LOGGER_DEFAULTS } from "./logger";

// Cookie parsing / writing / rewriting.
export {
  parseCookies,
  parseSetCookieString,
  parseSetCookieHeader,
  splitSetCookieString,
  serializeSetCookie,
  serializeCookie,
  rewriteCookie,
  rewriteSetCookieHeaders,
  getSetCookieHeaderValues,
  setSetCookieHeaderValues,
  rewriteResponseSetCookies,
  getCookieAttribute,
  getCookiePrefix,
  stripCookiePrefix,
  checkPrefixRequirements,
} from "./cookie";

// Generic helpers.
export { isObject, deepMerge } from "./utils";

// Types.
export type {
  PluginOptions,
  EnhancedProxyOptions,
  CookieRewriteOptions,
  LoggerOptions,
  LogLevel,
  ProxyOptions,
  ResolvedProxyLog,
  ResolvedProxyOptions,
  ResolvedConfig,
} from "./types";
export type {
  Logger,
  LoggerInstance,
  LogStream,
  HeadersLike,
  ProxyLogRequest,
  ProxyLogResponse,
  ProxyLogHandle,
} from "./logger";
export type {
  CookieAttribute,
  CookieRewriteRule,
  CookieSerializeOptions,
  CookiePrefixReport,
  ParsedCookie,
  SameSiteValue,
  SetCookieHeaderContainer,
} from "./cookie";