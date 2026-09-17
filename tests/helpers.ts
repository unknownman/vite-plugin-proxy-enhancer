import { EventEmitter } from "node:events";
import type { ProxyOptions } from "vite";
import { proxyEnhancer } from "../src/index";
import type { PluginOptions } from "../src/types";

/** A raw Node-style headers object (the shape http-proxy hands to `proxyRes`). */
export type Headers = Record<string, string | string[] | undefined>;

/**
 * Stand-in for http-proxy's `Server`: the plugin only ever calls `.on(...)`, so an
 * EventEmitter is enough to drive the `proxyRes` / `proxyReq` / `proxyReqWs` /
 * `error` handlers deterministically.
 */
export class FakeProxyServer extends EventEmitter {}

/** A minimal `IncomingMessage`-ish request object. */
export interface FakeRequest {
  method: string;
  url: string;
  headers: Headers;
}

export function fakeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return { method: "GET", url: "/api/users", headers: {}, ...overrides };
}

/** A minimal `ServerResponse`-ish object (the logger only listens for "close"). */
export function fakeResponse(): EventEmitter {
  return new EventEmitter();
}

/** A minimal `proxyRes` stream carrying headers/status, with `.on()` support. */
export type FakeProxyRes = EventEmitter & { headers: Headers; statusCode: number };

export function fakeProxyRes(headers: Headers, statusCode = 200): FakeProxyRes {
  const stream = new EventEmitter() as FakeProxyRes;
  stream.headers = headers;
  stream.statusCode = statusCode;
  return stream;
}

/**
 * Run the plugin's `config()` hook and return the `server.proxy` map it would give
 * Vite — i.e. the exact entries (with their `configure` hooks) used at runtime.
 */
export function proxyEntries(
  options: PluginOptions,
): Record<string, ProxyOptions> {
  const plugin = proxyEnhancer(options);
  const hook = plugin.config;
  if (hook === undefined) throw new Error("plugin does not define a config hook");

  const resolved = (
    typeof hook === "function"
      ? (hook as (config: unknown, env: unknown) => unknown).call(
          plugin,
          {},
          { command: "serve", mode: "development" },
        )
      : hook
  ) as { server?: { proxy?: Record<string, ProxyOptions> } };

  const proxy = resolved.server?.proxy;
  if (!proxy) throw new Error("plugin config did not provide server.proxy");
  return proxy;
}

/** Invoke a proxy entry's `configure` hook against a fake http-proxy server. */
export function configureEntry(
  entry: ProxyOptions,
  proxy: FakeProxyServer = new FakeProxyServer(),
): FakeProxyServer {
  if (typeof entry.configure !== "function") {
    throw new Error("entry does not define a configure hook");
  }
  entry.configure(proxy as never, {} as never);
  return proxy;
}
