import type {
  PluginOptions,
  EnhancedProxyOptions,
  CookieRewriteOptions,
  LoggerOptions,
  ResolvedProxyOptions,
  ResolvedConfig,
} from "./types";

// ─── Validation ────────────────────────────────────────────────

function throwConfigError(message: string): never {
  throw new Error(`[proxy-enhancer] Invalid configuration: ${message}`);
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
  try {
    new URL(target);
  } catch {
    throwConfigError(
      `proxy[${index}].target is not a valid URL: "${target}". Expected a full URL like "http://localhost:3001"`,
    );
  }
  return true;
}

// ─── Cookie Defaults ───────────────────────────────────────────

const COOKIE_DEFAULTS: Required<CookieRewriteOptions> = {
  rewriteDomain: false,
  domain: "",
  secure: false,
  rewritePath: false,
  path: "",
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

// ─── Logger Defaults ───────────────────────────────────────────

const LOGGER_DEFAULTS: Required<LoggerOptions> = {
  level: "info",
  logMatches: false,
  logCookieRewrites: false,
};

// ─── Per-Proxy Defaults ────────────────────────────────────────

const PROXY_DEFAULTS: Pick<Required<EnhancedProxyOptions>, "changeOrigin" | "secure"> = {
  changeOrigin: true,
  secure: true,
};

// ─── Main Resolver ─────────────────────────────────────────────

export function resolveConfig(options: PluginOptions): ResolvedConfig {
  if (options === null) {
    throwConfigError('expected an options object, got null. Pass { proxies: [...] }');
  }
  if (typeof options !== "object") {
    throwConfigError("expected an object, got " + typeof options);
  }

  if (!Array.isArray(options.proxies)) {
    throwConfigError(
      '"proxies" must be an array of proxy configurations. Received: ' +
        typeof options.proxies,
    );
  }

  const logger = { ...LOGGER_DEFAULTS, ...options.logger };
  const defaults = options.defaults ?? {};

  const proxies: ResolvedProxyOptions[] = options.proxies.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throwConfigError(
        `proxy[${i}] must be an object, got ${typeof entry}`,
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
    };

    return resolved;
  });

  return { proxies, logger };
}
