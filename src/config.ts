import type {
  PluginOptions,
  EnhancedProxyOptions,
  CookieRewriteOptions,
  LoggerOptions,
  ResolvedProxyLog,
  ResolvedProxyOptions,
  ResolvedConfig,
} from "./types";
import { LOGGER_DEFAULTS } from "./logger";

// ─── Validation ────────────────────────────────────────────────

/** Prefix used for every error/warning the plugin surfaces, for easy grepping. */
const ERROR_PREFIX = "[proxy-enhancer]";

function throwConfigError(message: string): never {
  throw new Error(`${ERROR_PREFIX} Invalid configuration: ${message}`);
}

function validatePattern(
  pattern: unknown,
  index: number,
): pattern is string {
  if (typeof pattern !== "string") {
    throwConfigError(
      `proxy[${index}].pattern must be a string, got ${typeof pattern}`,
    );
  }
  if (pattern === "") {
    throwConfigError(`proxy[${index}].pattern must not be empty`);
  }
  // Vite matches proxies against the request URL path: a leading "/" enables glob
  // matching ("/api/**"), a leading "^" enables a RegExp ("^/api/.*"). Anything
  // else can never match, so fail early instead of silently proxying nothing.
  if (!pattern.startsWith("/") && !pattern.startsWith("^")) {
    throwConfigError(
      `proxy[${index}].pattern "${pattern}" will never match a request. ` +
        'Patterns are matched against URL paths, so they must start with "/" ' +
        '(e.g. "/api" or "/api/**") or "^" for a RegExp (e.g. "^/api/.*").',
    );
  }
  return true;
}

function validateTarget(
  target: unknown,
  index: number,
): target is string {
  if (typeof target !== "string") {
    throwConfigError(
      `proxy[${index}].target must be a string, got ${typeof target}`,
    );
  }
  if (target === "") {
    throwConfigError(`proxy[${index}].target must not be empty`);
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throwConfigError(
      `proxy[${index}].target is not a valid URL: "${target}". ` +
        'Expected a full URL with a protocol, e.g. "http://localhost:3001" ' +
        'or "https://api.example.com".',
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throwConfigError(
      `proxy[${index}].target "${target}" uses protocol "${parsed.protocol}", ` +
        'which http-proxy cannot forward to. Only "http:" and "https:" targets are supported.',
    );
  }
  return true;
}

// ─── Cookie Defaults ───────────────────────────────────────────

const COOKIE_DEFAULTS: CookieRewriteOptions = {
  rewriteDomain: false,
  rewritePath: false,
  inject: {},
  exclude: [],
};

function resolveCookieRewrite(
  input: CookieRewriteOptions | boolean | undefined,
): CookieRewriteOptions | false {
  if (input === undefined || input === false) return false;
  if (input === true) return { ...COOKIE_DEFAULTS };
  return { ...COOKIE_DEFAULTS, ...input };
}

// ─── Logger Resolution ─────────────────────────────────────────

function resolveProxyLog(
  input: boolean | LoggerOptions | undefined,
  globalLogger: Required<LoggerOptions>,
): ResolvedProxyLog {
  if (input === undefined || input === true) {
    return { enabled: true, options: globalLogger };
  }
  if (input === false) {
    return { enabled: false, options: globalLogger };
  }
  return { enabled: true, options: { ...globalLogger, ...input } };
}

// ─── Per-Proxy Defaults ────────────────────────────────────────

const PROXY_DEFAULTS: Pick<Required<EnhancedProxyOptions>, "changeOrigin" | "secure"> = {
  changeOrigin: true,
  secure: true,
};

// ─── Main Resolver ─────────────────────────────────────────────

/**
 * Validate and fully resolve the plugin options.
 *
 * Applies the merge precedence `PROXY_DEFAULTS < defaults < entry`, resolves
 * `cookieRewrite` (boolean shorthand → object) and `log` (boolean/object → a
 * `{ enabled, options }` pair), and throws descriptive errors on any
 * misconfiguration so misbehaving proxies fail at startup rather than silently.
 *
 * @example
 * resolveConfig({ proxies: [{ pattern: "/api", target: "http://localhost:3001" }] })
 * @param options The raw plugin options.
 * @throws {Error} With a `[proxy-enhancer]`-prefixed, actionable message when the
 *   configuration is invalid (missing proxies, bad patterns/targets, etc.).
 * @returns The resolved configuration.
 */
export function resolveConfig(options: PluginOptions): ResolvedConfig {
  if (options === undefined || options === null) {
    throwConfigError(
      `expected an options object, got ${options === null ? "null" : "undefined"}. ` +
        'Call the plugin with an options object: proxyEnhancer({ proxies: [...] }).',
    );
  }
  if (typeof options !== "object") {
    throwConfigError("expected an options object, got " + typeof options);
  }

  if (!Array.isArray(options.proxies)) {
    throwConfigError(
      '"proxies" must be an array of proxy configurations. Received: ' +
        (options.proxies === undefined
          ? "undefined (missing the \"proxies\" option?)"
          : typeof options.proxies),
    );
  }

  if (options.defaults !== undefined && typeof options.defaults !== "object") {
    throwConfigError(
      '"defaults" must be an object of proxy defaults, got ' +
        typeof options.defaults,
    );
  }

  const globalLogger = { ...LOGGER_DEFAULTS, ...options.logger };
  const defaults = options.defaults ?? {};

  const proxies: ResolvedProxyOptions[] = options.proxies.map((entry, i) => {
    const label = `proxy[${i}] (pattern: ${JSON.stringify((entry as { pattern?: unknown } | null)?.pattern ?? null)})`;

    if (entry === undefined || entry === null || typeof entry !== "object") {
      throwConfigError(
        `${label} must be an object with "pattern" and "target", got ${entry === null ? "null" : typeof entry}`,
      );
    }

    validatePattern(entry.pattern, i);
    validateTarget(entry.target, i);

    const merged = { ...PROXY_DEFAULTS, ...defaults, ...entry };

    const resolved: ResolvedProxyOptions = {
      ...merged,
      pattern: entry.pattern,
      target: entry.target,
      cookieRewrite: resolveCookieRewrite(merged.cookieRewrite),
      log: resolveProxyLog(merged.log, globalLogger),
    };

    return resolved;
  });

  return { proxies, logger: globalLogger };
}
