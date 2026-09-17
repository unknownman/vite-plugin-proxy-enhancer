import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureEntry,
  fakeProxyRes,
  fakeRequest,
  fakeResponse,
  proxyEntries,
  type Headers,
} from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Multiple Set-Cookie headers are preserved as separate headers ──

describe("plugin: multiple Set-Cookie headers", () => {
  it("rewrites and re-emits one distinct header per cookie", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [{ pattern: "/api", target: "http://localhost:3001", cookieRewrite: { path: "/" } }],
    });
    const proxy = configureEntry(entries["/api"]);
    const proxyRes = fakeProxyRes({
      "set-cookie": ["a=1; Path=/api", "b=2; Path=/api"],
    });

    proxy.emit("proxyRes", proxyRes, fakeRequest(), fakeResponse());

    expect(proxyRes.headers["set-cookie"]).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(Array.isArray(proxyRes.headers["set-cookie"])).toBe(true);
  });
});

// ─── 2. Domain / Path / SameSite / Secure rewriting through the plugin ─

describe("plugin: attribute rewriting", () => {
  it("rewrites Domain/Path and forces Secure for SameSite=None", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [
        {
          pattern: "/api",
          target: "http://localhost:3001",
          cookieRewrite: { rewriteDomain: true, path: "/" },
        },
      ],
    });
    const proxy = configureEntry(entries["/api"]);
    const proxyRes = fakeProxyRes({
      "set-cookie": ["session=abc; Domain=api.example.com; Path=/api; SameSite=None"],
    });

    proxy.emit("proxyRes", proxyRes, fakeRequest(), fakeResponse());

    expect(proxyRes.headers["set-cookie"]).toEqual([
      "session=abc; Path=/; SameSite=None; Secure",
    ]);
  });
});

// ─── 4. Cookie injection through the plugin ───────────────────────────

describe("plugin: cookie injection", () => {
  it("appends configured cookies to every proxied response", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [
        {
          pattern: "/api",
          target: "http://localhost:3001",
          cookieRewrite: { inject: { flag: "on" }, path: "/" },
        },
      ],
    });
    const proxy = configureEntry(entries["/api"]);
    const proxyRes = fakeProxyRes({ "set-cookie": ["a=1; Path=/"] });

    proxy.emit("proxyRes", proxyRes, fakeRequest(), fakeResponse());

    expect(proxyRes.headers["set-cookie"]).toEqual(["a=1; Path=/", "flag=on; Path=/"]);
  });
});

// ─── 5. exclude list through the plugin ───────────────────────────────

describe("plugin: exclude list", () => {
  it("does not touch excluded cookies", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [
        {
          pattern: "/api",
          target: "http://localhost:3001",
          cookieRewrite: { rewriteDomain: true, exclude: ["keep"] },
        },
      ],
    });
    const proxy = configureEntry(entries["/api"]);
    const proxyRes = fakeProxyRes({
      "set-cookie": ["keep=1; Domain=a.com", "drop=2; Domain=a.com"],
    });

    proxy.emit("proxyRes", proxyRes, fakeRequest(), fakeResponse());

    expect(proxyRes.headers["set-cookie"]).toEqual(["keep=1; Domain=a.com", "drop=2"]);
  });
});

// ─── 6. Logging does not break when headers are missing ───────────────

describe("plugin: logging robustness", () => {
  it("logs a response with no Set-Cookie header without throwing", () => {
    const entries = proxyEntries({
      logger: { level: "info", color: false },
      proxies: [
        {
          pattern: "/api",
          target: "http://localhost:3001",
          cookieRewrite: true,
          log: {
            level: "info",
            color: false,
            logCookieRewrites: true,
            showResponseHeaders: true,
            showBody: true,
          },
        },
      ],
    });
    const proxy = configureEntry(entries["/api"]);
    const req = fakeRequest();
    const res = fakeResponse();
    const proxyRes = fakeProxyRes({ "content-type": "text/plain" });

    expect(() => {
      proxy.emit("proxyReq", { on() {} }, req, res);
      proxy.emit("proxyRes", proxyRes, req, res);
      proxyRes.emit("data", Buffer.from("hello"));
      proxyRes.emit("end");
    }).not.toThrow();
  });

  it("survives a response with no headers at all", () => {
    const entries = proxyEntries({
      logger: { level: "info", color: false },
      proxies: [
        {
          pattern: "/api",
          target: "http://localhost:3001",
          cookieRewrite: true,
          log: { level: "info", color: false, showResponseHeaders: true },
        },
      ],
    });
    const proxy = configureEntry(entries["/api"]);
    const req = fakeRequest();
    const res = fakeResponse();
    const proxyRes = new EventEmitter() as EventEmitter & { statusCode: number };
    proxyRes.statusCode = 204;

    expect(() => {
      proxy.emit("proxyReq", { on() {} }, req, res);
      proxy.emit("proxyRes", proxyRes, req, res);
      proxyRes.emit("end");
    }).not.toThrow();
  });
});

// ─── 7. Invalid / malformed Set-Cookie headers do not crash ───────────

describe("plugin: malformed cookie handling", () => {
  it("drops malformed cookies and keeps the valid ones", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [{ pattern: "/api", target: "http://localhost:3001", cookieRewrite: { path: "/" } }],
    });
    const proxy = configureEntry(entries["/api"]);
    const proxyRes = fakeProxyRes({
      "set-cookie": ["totally malformed", "=;=;=", "ok=1; Path=/api"],
    });

    expect(() => proxy.emit("proxyRes", proxyRes, fakeRequest(), fakeResponse())).not.toThrow();
    expect(proxyRes.headers["set-cookie"]).toEqual(["ok=1; Path=/"]);
  });

  it("removes the header when every cookie is malformed", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [{ pattern: "/api", target: "http://localhost:3001", cookieRewrite: true }],
    });
    const proxy = configureEntry(entries["/api"]);
    const proxyRes = fakeProxyRes({ "set-cookie": ["nope", "also-nope"] });

    proxy.emit("proxyRes", proxyRes, fakeRequest(), fakeResponse());

    expect(proxyRes.headers).not.toHaveProperty("set-cookie");
  });

  it("catches unexpected errors, warns, and keeps proxying", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entries = proxyEntries({
      logger: { level: "info", color: false },
      proxies: [{ pattern: "/api", target: "http://localhost:3001", cookieRewrite: true }],
    });
    const proxy = configureEntry(entries["/api"]);

    const proxyRes = new EventEmitter() as EventEmitter;
    Object.defineProperty(proxyRes, "headers", {
      get() {
        throw new Error("boom");
      },
    });

    expect(() => proxy.emit("proxyRes", proxyRes, fakeRequest(), fakeResponse())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cookie rewrite failed"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});

// ─── 8. WebSocket proxying still works ────────────────────────────────

describe("plugin: WebSocket support", () => {
  it("forwards the native ws option and handles proxyReqWs", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [{ pattern: "/ws", target: "http://localhost:3001", ws: true }],
    });

    expect(entries["/ws"].ws).toBe(true);

    const proxy = configureEntry(entries["/ws"]);
    expect(() =>
      proxy.emit("proxyReqWs", { on() {} }, fakeRequest({ url: "/ws" }), {}),
    ).not.toThrow();
  });
});

// ─── Integration-style: simulate a real proxyRes event ────────────────

describe("integration: simulated proxyRes lifecycle", () => {
  it("runs the whole cookie pipeline for one proxied response", () => {
    const entries = proxyEntries({
      logger: { level: "silent" },
      proxies: [
        {
          pattern: "/api/**",
          target: "http://localhost:3001",
          cookieRewrite: {
            rewriteDomain: true,
            path: "/",
            secure: false,
            inject: { feature: "on" },
          },
        },
      ],
    });
    const proxy = configureEntry(entries["/api/**"]);
    const proxyRes = fakeProxyRes({
      "content-type": "application/json",
      "set-cookie": [
        "session=abc; Domain=api.example.com; Path=/api; SameSite=None; HttpOnly",
        "csrf=xyz; Domain=api.example.com; Path=/api",
      ],
    });

    // Exactly what http-proxy emits when the backend answers.
    proxy.emit("proxyRes", proxyRes, fakeRequest({ url: "/api/users" }), fakeResponse());

    expect(proxyRes.headers["set-cookie"]).toEqual([
      "session=abc; Path=/; SameSite=None; HttpOnly; Secure",
      "csrf=xyz; Path=/",
      "feature=on; Path=/",
    ]);
    // Unrelated headers must be left alone.
    expect(proxyRes.headers["content-type"]).toBe("application/json");
  });
});
