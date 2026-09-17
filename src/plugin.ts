import type { IncomingMessage } from "node:http";
import type { Plugin, ProxyOptions, HttpProxy } from "vite";
import type {
  PluginOptions,
  ResolvedConfig,
  ResolvedProxyOptions,
  CookieRewriteOptions,
} from "./types";
import { resolveConfig } from "./config";
import { createLogger } from "./logger";
import type { Logger, ProxyLogHandle } from "./logger";
import {
  parseSetCookieString,
  getSetCookieHeaderValues,
  injectResponseCookies,
  rewriteResponseSetCookies,
} from "./cookie";

/** Plugin name, surfaced by Vite and included in every diagnostic message. */
const PLUGIN_NAME = "vite-plugin-proxy-enhancer";

/** Best-effort message for an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `"METHOD /url (pattern "…" -> target)"`, for runtime diagnostics. */
function describeRequest(
  rule: ResolvedProxyOptions,
  req?: { method?: string; url?: string },
): string {
  return `${req?.method ?? "GET"} ${req?.url ?? "/"} (pattern "${rule.pattern}" -> ${rule.target})`;
}

/**
 * Summarize a cookie rewriting pass for the `logCookieRewrites` option: which
 * cookies were rewritten, injected, added, or passed through unchanged.
 */
function logCookieRewrites(
  input: string[],
  output: string[],
  rule: CookieRewriteOptions,
  logger: Logger,
): void {
  const originalByName = new Map<string, string>();
  for (const raw of input) {
    const parsed = parseSetCookieString(raw);
    if (parsed) originalByName.set(parsed.name, raw.trim());
  }

  const injected = new Set(Object.keys(rule.inject ?? {}));
  const modified: string[] = [];
  const injectedList: string[] = [];
  const added: string[] = [];
  const untouched: string[] = [];

  for (const serialized of output) {
    const parsed = parseSetCookieString(serialized);
    if (!parsed) continue;
    if (injected.has(parsed.name)) {
      injectedList.push(parsed.name);
      continue;
    }
    const original = originalByName.get(parsed.name);
    if (original === undefined) {
      added.push(parsed.name);
    } else if (original !== serialized.trim()) {
      modified.push(parsed.name);
    } else {
      untouched.push(parsed.name);
    }
  }

  if (modified.length > 0) {
    logger.info(`    cookies rewritten: ${modified.join(", ")}`);
  }
  if (injectedList.length > 0) {
    logger.info(`    cookies injected: ${injectedList.join(", ")}`);
  }
  if (added.length > 0) {
    logger.info(`    cookies added: ${added.join(", ")}`);
  }
  if (untouched.length > 0) {
    logger.debug(`    cookies unchanged: ${untouched.join(", ")}`);
  }
}

/** Which optional behaviors a given proxy rule asked for. */
interface HandlerRequirements {
  cookieRewrite: boolean;
  logging: boolean;
}

/**
 * Attach the plugin's http-proxy event handlers to a configured proxy server.
 *
 * - `proxyRes`: cookie rewriting (with `logCookieRewrites` summaries) plus
 *   request-log completion.
 * - `proxyReq`: start a per-request log.
 * - `proxyReqWs`: log WebSocket upgrades (http-proxy emits no `proxyRes` for WS).
 * - `error`: complete any pending log so failures are still reported.
 *
 * Every handler is defensive: it validates its inputs, wraps its body in a
 * try/catch, and never lets an unexpected error break proxying for other
 * requests. Failures are reported through the rule's logger when request logging
 * is on, otherwise through the plugin's global logger so they stay visible.
 */
function attachProxyHandlers(
  proxy: HttpProxy.Server,
  rule: ResolvedProxyOptions,
  reqs: HandlerRequirements,
  fallbackLogger: Logger,
): void {
  if (proxy === null || typeof proxy !== "object" || typeof proxy.on !== "function") {
    fallbackLogger.warn(
      `cannot attach proxy handlers for pattern "${rule.pattern}" -> ${rule.target}: ` +
        "the http-proxy server does not expose an .on() method.",
    );
    return;
  }

  const cookieRule = rule.cookieRewrite;
  const pending = new WeakMap<IncomingMessage, ProxyLogHandle>();
  const requestLogger = reqs.logging ? createLogger(rule.log.options) : null;
  const warnLogger = requestLogger ?? fallbackLogger;

  if (reqs.cookieRewrite && cookieRule !== false) {
    proxy.on("proxyRes", (proxyRes, req) => {
      try {
        const headers = proxyRes?.headers;
        if (!headers || typeof headers !== "object") return;

        // Set-Cookie CANNOT be folded into a comma-separated single header
        // (RFC 6265 §4.1) — a browser would only store the first cookie, silently
        // dropping the rest. Node/http-proxy forward it as an array, but anything
        // that re-emits it as a string loses cookies (see vitejs/vite#23450).
        // So: treat headers["set-cookie"] as an array end-to-end.
        const before = getSetCookieHeaderValues(headers);
        // Extract → rewrite each cookie individually → write back as `string[]`,
        // guaranteeing one distinct Set-Cookie header per cookie.
        rewriteResponseSetCookies(headers, cookieRule);
        // Re-assign as a fresh array (never a joined string), so Node writes one
        // "Set-Cookie:" line per element. Empty ⇒ header is removed entirely.
        const merged = injectResponseCookies(
          headers,
          cookieRule.inject ?? {},
          {
            domain: cookieRule.domain,
            path: cookieRule.path,
            secure: cookieRule.secure,
            httpOnly: cookieRule.httpOnly,
            sameSite: cookieRule.sameSite,
          },
        );
        if (requestLogger && rule.log.options.logCookieRewrites) {
          logCookieRewrites(before, merged, cookieRule, requestLogger);
        }
      } catch (error) {
        warnLogger.warn(
          `cookie rewrite failed for ${describeRequest(rule, req)}: ${errorMessage(error)}`,
        );
      }
    });
  }

  if (!reqs.logging || requestLogger === null) return;

  proxy.on("proxyReq", (proxyReq, req, _res) => {
    try {
      if (!rule.log.enabled) return;
      pending.set(
        req,
        requestLogger.request({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          target: rule.target,
          pattern: rule.pattern,
          headers: rule.log.options.showRequestHeaders
            ? req.headers
            : undefined,
        }),
      );
    } catch (error) {
      warnLogger.warn(
        `request logging failed for ${describeRequest(rule, req)}: ${errorMessage(error)}`,
      );
    }
  });

  proxy.on("proxyRes", (proxyRes, req, res) => {
    try {
      const handle = pending.get(req);
      if (!handle) return;
      pending.delete(req);

      const showBody = rule.log.options.showBody;
      let body = "";
      let done = false;
      const finish = (response?: {
        statusCode: number;
        headers?: Record<string, string | string[] | undefined>;
        body?: string;
      }) => {
        if (done) return;
        done = true;
        handle.end(response);
      };

      if (typeof proxyRes?.on !== "function") {
        finish();
        return;
      }

      if (showBody) {
        proxyRes.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
      }
      proxyRes.on("end", () => {
        finish({
          statusCode: proxyRes.statusCode ?? 502,
          headers: proxyRes.headers,
          body: showBody ? body : undefined,
        });
      });
      if (typeof res?.on === "function") {
        res.on("close", () => finish());
      }
    } catch (error) {
      warnLogger.warn(
        `response logging failed for ${describeRequest(rule, req)}: ${errorMessage(error)}`,
      );
    }
  });

  proxy.on("proxyReqWs", (proxyReq, req, _socket) => {
    try {
      if (!rule.log.enabled) return;
      const handle = requestLogger.request({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        target: rule.target,
        pattern: rule.pattern,
        headers: rule.log.options.showRequestHeaders
          ? req.headers
          : undefined,
      });
      handle.end({ statusCode: 101 });
    } catch (error) {
      warnLogger.warn(
        `WebSocket logging failed for ${describeRequest(rule, req)}: ${errorMessage(error)}`,
      );
    }
  });

  proxy.on("error", (_err, req, _res) => {
    try {
      if (req === null || typeof req !== "object") return;
      const handle = pending.get(req);
      if (handle) {
        pending.delete(req);
        handle.end();
      }
    } catch {
      // An error while handling an error: nothing left to report it with.
    }
  });
}

/**
 * Convert a resolved proxy rule into a Vite `ProxyOptions` object.
 *
 * Every native Vite option (`ws`, `rewrite`, `bypass`, `headers`, …) passes
 * through untouched. The plugin's cookie rewriting and logging run from a single
 * composed `configure` hook, which wraps — and never replaces — any `configure`
 * the user supplied.
 */
function buildProxyEntry(
  rule: ResolvedProxyOptions,
  logger: Logger,
): ProxyOptions {
  const { pattern, target, cookieRewrite, log, configure, ...rest } = rule;

  const needsCookieRewrite = cookieRewrite !== false;
  const needsLogging = log.enabled;
  const userConfigure = typeof configure === "function" ? configure : undefined;

  const entry: ProxyOptions = {
    ...rest,
    target,
    changeOrigin: rule.changeOrigin,
    secure: rule.secure,
  };

  if (needsCookieRewrite || needsLogging || userConfigure) {
    entry.configure = (proxy, options) => {
      // Compose with the user's own hook. A user hook that throws must not stop
      // the plugin's enhancements from being installed — report and carry on.
      if (userConfigure) {
        try {
          userConfigure(proxy, options);
        } catch (error) {
          logger.error(
            `user configure() hook for proxy "${pattern}" -> ${target} threw: ${errorMessage(error)}`,
          );
        }
      }
      attachProxyHandlers(
        proxy,
        rule,
        { cookieRewrite: needsCookieRewrite, logging: needsLogging },
        logger,
      );
    };
  }

  return entry;
}

/** True when `value` is a plain, non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A Vite plugin that enhances `server.proxy` with cookie rewriting and logging.
 *
 * Pass your proxy rules through the plugin's `proxies` option instead of (or
 * alongside) Vite's native `server.proxy`. Every rule accepts all standard Vite
 * proxy options plus:
 *
 * - `cookieRewrite` — rewrite `Domain`/`Path`/`Secure`/`HttpOnly`/`SameSite` on
 *   `Set-Cookie` response headers (works with multiple cookies per response) and
 *   inject extra cookies.
 * - `log` — per-rule request logging (method, URL, status, duration, target, and
 *   optionally headers/body), or `false` to silence a rule.
 * - `defaults` / `logger` at the top level — shared settings for every rule.
 *
 * Rules are merged into Vite's `server.proxy` under their `pattern`, so any
 * `server.proxy` entries you define yourself keep working unchanged. If both the
 * plugin and `server.proxy` define the same pattern, the plugin's entry wins and
 * a warning is logged. WebSocket proxying is supported by forwarding the native
 * `ws` option; cookie rewriting applies to HTTP responses, while WebSocket
 * upgrades are covered by logging (`proxyReqWs`).
 *
 * Configuration is validated eagerly; invalid input throws a descriptive error at
 * startup instead of silently proxying nothing. At runtime, per-request failures
 * (e.g. an unparseable `Set-Cookie`) are caught and logged rather than tearing
 * down the proxy.
 *
 * @example
 * proxyEnhancer({
 *   defaults: { changeOrigin: true, cookieRewrite: true },
 *   proxies: [{ pattern: "/api", target: "http://localhost:3001" }],
 * })
 *
 * @param options Plugin options ({@link PluginOptions}).
 * @throws {Error} With an actionable message when `options` are invalid.
 * @returns A Vite {@link Plugin}.
 */
export function proxyEnhancer(options: PluginOptions): Plugin {
  const resolved: ResolvedConfig = resolveConfig(options);
  const logger = createLogger(resolved.logger);

  return {
    name: PLUGIN_NAME,

    config(config) {
      // Rebuild the entries on every call so Vite can safely mutate/freeze the
      // returned config without corrupting the plugin's own state.
      const proxy: Record<string, ProxyOptions> = {};
      for (const rule of resolved.proxies) {
        proxy[rule.pattern] = buildProxyEntry(rule, logger);
      }

      // `server.proxy` is deep-merged key-by-key, with the plugin's entries as
      // overrides. Detect patterns the user also declared manually so a silent
      // override never becomes a surprise.
      const userProxy = config.server?.proxy;
      if (isPlainObject(userProxy)) {
        const overridden = resolved.proxies
          .map((rule) => rule.pattern)
          .filter((pattern) =>
            Object.prototype.hasOwnProperty.call(userProxy, pattern),
          );
        if (overridden.length > 0) {
          logger.warn(
            `overriding manually configured server.proxy pattern(s): ` +
              `${overridden.map((p) => `"${p}"`).join(", ")}. ` +
              `Remove them from server.proxy (or stop defining them in the plugin) ` +
              `to avoid confusion.`,
          );
        }
      }

      return { server: { proxy } };
    },

    configResolved(config) {
      const count = resolved.proxies.length;
      if (count === 0) {
        logger.warn(
          'No proxy rules to configure — the "proxies" array is empty.',
        );
      } else {
        logger.info(
          `Configuring ${count} proxy entr${count === 1 ? "y" : "ies"}`,
        );
        for (const rule of resolved.proxies) {
          logger.debug(`  ${rule.pattern} -> ${rule.target}`);
        }
      }

      const serverProxy = config.server?.proxy;
      if (isPlainObject(serverProxy)) {
        const managed = new Set(
          resolved.proxies.map((rule) => rule.pattern),
        );
        const foreign = Object.keys(serverProxy).filter(
          (key) => !managed.has(key),
        );
        if (foreign.length > 0) {
          logger.warn(
            `Vite config has ${foreign.length} proxy pattern(s) not managed by ` +
              `vite-plugin-proxy-enhancer: ${foreign.map((k) => `"${k}"`).join(", ")}. ` +
              "Define all proxies through the plugin's \"proxies\" option so they get " +
              "cookie rewriting and logging.",
          );
        }
      }
    },
  };
}
