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
  rewriteSetCookieHeaders,
  serializeCookie,
  splitSetCookieString,
  parseSetCookieString,
} from "./cookie";

/**
 * Append the cookies declared in {@link CookieRewriteOptions.inject} to the base
 * `Set-Cookie` list, serialized with the rule's attribute settings.
 */
function injectCookies(
  rule: CookieRewriteOptions,
  base: string[],
): string[] {
  const entries = Object.entries(rule.inject ?? {});
  if (entries.length === 0) return base;

  const out = base.slice();
  for (const [name, value] of entries) {
    out.push(
      serializeCookie(name, value, {
        domain: rule.domain,
        path: rule.path,
        secure: rule.secure,
        httpOnly: rule.httpOnly,
        sameSite: rule.sameSite,
      }),
    );
  }
  return out;
}

/**
 * Summarize a cookie rewriting pass for the `logCookieRewrites` option: which
 * cookies were rewritten, injected, added, or passed through unchanged.
 */
function logCookieRewrites(
  input: string | string[] | undefined,
  output: string[],
  rule: CookieRewriteOptions,
  logger: Logger,
): void {
  const sources =
    input === undefined
      ? []
      : Array.isArray(input)
        ? input
        : splitSetCookieString(input);
  const originalByName = new Map<string, string>();
  for (const raw of sources) {
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
 * - `proxyRes`/`proxyReq`: cookie rewriting (with `logCookieRewrites` summaries)
 *   and per-request logging.
 * - `proxyReqWs`: logging for WebSocket upgrades.
 * - `error`: completes any pending log so failures are still reported.
 *
 * Every handler stays defensive: an unexpected error in one request never breaks
 * proxying for subsequent ones.
 */
function attachProxyHandlers(
  proxy: HttpProxy.Server,
  rule: ResolvedProxyOptions,
  reqs: HandlerRequirements,
): void {
  const cookieRule = rule.cookieRewrite;
  const pending = new WeakMap<IncomingMessage, ProxyLogHandle>();
  const logger = reqs.logging ? createLogger(rule.log.options) : null;

  if (reqs.cookieRewrite && cookieRule !== false) {
    proxy.on("proxyRes", (proxyRes, req) => {
      try {
        const setCookie = proxyRes.headers["set-cookie"];
        const rewritten =
          setCookie === undefined
            ? []
            : rewriteSetCookieHeaders(setCookie, cookieRule);
        // Rewritten cookies stay a `string[]`, one serialized header per cookie,
        // so multiple Set-Cookie headers are never collapsed into one string.
        const merged = injectCookies(cookieRule, rewritten);
        if (merged.length > 0) {
          proxyRes.headers["set-cookie"] = merged;
        }
        if (logger && rule.log.options.logCookieRewrites) {
          logCookieRewrites(setCookie, merged, cookieRule, logger);
        }
      } catch (error) {
        logger?.warn(
          `cookie rewrite failed for ${req.method ?? "GET"} ${req.url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  }

  if (!reqs.logging || logger === null) return;

  proxy.on("proxyReq", (proxyReq, req, _res) => {
    if (!rule.log.enabled) return;
    pending.set(
      req,
      logger.request({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        target: rule.target,
        pattern: rule.pattern,
        headers: rule.log.options.showRequestHeaders
          ? req.headers
          : undefined,
      }),
    );
  });

  proxy.on("proxyRes", (proxyRes, req, res) => {
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
    res.on("close", () => finish());
  });

  proxy.on("proxyReqWs", (proxyReq, req, _socket) => {
    if (!rule.log.enabled) return;
    const handle = logger.request({
      method: req.method ?? "GET",
      url: req.url ?? "/",
      target: rule.target,
      pattern: rule.pattern,
      headers: rule.log.options.showRequestHeaders
        ? req.headers
        : undefined,
    });
    handle.end({ statusCode: 101 });
  });

  proxy.on("error", (_err, req, _res) => {
    const handle = pending.get(req);
    if (handle) {
      pending.delete(req);
      handle.end();
    }
  });
}

/**
 * Convert a resolved proxy rule into a Vite `ProxyOptions` object.
 *
 * Every native Vite option passes through untouched; the plugin wires its cookie
 * rewriting and logging through the http-proxy `configure` hook, running the
 * user's own `configure` first when one was supplied.
 */
function buildProxyEntry(rule: ResolvedProxyOptions): ProxyOptions {
  const { pattern, target, cookieRewrite, log, configure, ...rest } = rule;

  const needsCookieRewrite = cookieRewrite !== false;
  const needsLogging = log.enabled;

  const entry: ProxyOptions = {
    ...rest,
    target,
    changeOrigin: rule.changeOrigin,
    secure: rule.secure,
  };

  if (needsCookieRewrite || needsLogging || configure !== undefined) {
    entry.configure = (proxy, options) => {
      configure?.(proxy, options);
      attachProxyHandlers(proxy, rule, {
        cookieRewrite: needsCookieRewrite,
        logging: needsLogging,
      });
    };
  }

  return entry;
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
 * Configuration is validated eagerly; invalid input throws a descriptive error at
 * startup instead of silently proxying nothing. At runtime, per-request failures
 * (e.g. an unparseable `Set-Cookie`) are caught and logged rather than tearing
 * down the proxy.
 *
 * @example
 * proxyEnhancer({
 *   defaults: { changeOrigin: true, cookieRewrite: true },
 *   proxies: [{ pattern: "/api/**", target: "http://localhost:3001" }],
 * })
 *
 * @param options Plugin options ({@link PluginOptions}).
 * @throws {Error} With an actionable message when `options` are invalid.
 * @returns A Vite {@link Plugin}.
 */
export function proxyEnhancer(options: PluginOptions): Plugin {
  const resolved: ResolvedConfig = resolveConfig(options);
  const logger = createLogger(resolved.logger);

  const proxy: Record<string, string | ProxyOptions> = {};
  for (const rule of resolved.proxies) {
    proxy[rule.pattern] = buildProxyEntry(rule);
  }

  return {
    name: "vite-plugin-proxy-enhancer",

    config() {
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
      if (
        serverProxy &&
        typeof serverProxy === "object" &&
        !Array.isArray(serverProxy)
      ) {
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