export { proxyEnhancer } from "./plugin";
export { resolveConfig } from "./config";
export { createLogger, LOGGER_DEFAULTS } from "./logger";
export {
  parseCookies,
  parseSetCookieString,
  parseSetCookieHeader,
  splitSetCookieString,
  serializeSetCookie,
  serializeCookie,
  rewriteCookie,
  rewriteSetCookieHeaders,
  getCookieAttribute,
  getCookiePrefix,
  stripCookiePrefix,
  checkPrefixRequirements,
} from "./cookie";
export type {
  PluginOptions,
  EnhancedProxyOptions,
  CookieRewriteOptions,
  LoggerOptions,
  LogLevel,
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
} from "./cookie";