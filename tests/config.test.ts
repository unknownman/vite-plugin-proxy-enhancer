import { describe, expect, it } from "vitest";
import { proxyEnhancer, resolveConfig } from "../src/index";

const valid = {
  proxies: [{ pattern: "/api", target: "http://localhost:3001" }],
};

describe("configuration validation", () => {
  it("rejects a missing or non-object options argument", () => {
    expect(() => resolveConfig(undefined as never)).toThrow(/expected an options object/);
    expect(() => resolveConfig(null as never)).toThrow(/expected an options object, got null/);
    expect(() => resolveConfig("nope" as never)).toThrow(/expected an options object/);
  });

  it("requires a proxies array", () => {
    expect(() => resolveConfig({} as never)).toThrow(/"proxies" must be an array/);
    expect(() => resolveConfig({} as never)).toThrow(/missing the "proxies" option/);
    expect(() => resolveConfig({ proxies: "/api" } as never)).toThrow(/Received: string/);
  });

  it("rejects non-object proxy entries", () => {
    expect(() => resolveConfig({ proxies: [null] } as never)).toThrow(
      /must be an object with "pattern" and "target", got null/,
    );
    expect(() => resolveConfig({ proxies: ["/api"] } as never)).toThrow(
      /must be an object with "pattern" and "target", got string/,
    );
  });

  it("rejects patterns that can never match", () => {
    expect(() =>
      resolveConfig({ proxies: [{ pattern: 1, target: "http://x.com" }] } as never),
    ).toThrow(/proxy\[0\]\.pattern must be a string, got number/);
    expect(() =>
      resolveConfig({ proxies: [{ pattern: "", target: "http://x.com" }] } as never),
    ).toThrow(/proxy\[0\]\.pattern must not be empty/);
    expect(() =>
      resolveConfig({ proxies: [{ pattern: "api", target: "http://x.com" }] } as never),
    ).toThrow(/will never match a request/);
  });

  it("rejects invalid targets", () => {
    expect(() =>
      resolveConfig({ proxies: [{ pattern: "/api", target: 1 }] } as never),
    ).toThrow(/proxy\[0\]\.target must be a string, got number/);
    expect(() =>
      resolveConfig({ proxies: [{ pattern: "/api", target: "" }] } as never),
    ).toThrow(/proxy\[0\]\.target must not be empty/);
    expect(() =>
      resolveConfig({ proxies: [{ pattern: "/api", target: "not a url" }] } as never),
    ).toThrow(/is not a valid URL/);
    expect(() =>
      resolveConfig({ proxies: [{ pattern: "/api", target: "ftp://x.com" }] } as never),
    ).toThrow(/uses protocol "ftp:"/);
    expect(() =>
      resolveConfig({ proxies: [{ pattern: "/api", target: "ws://x.com" }] } as never),
    ).toThrow(/set `ws: true`/);
  });

  it("rejects a non-object defaults option", () => {
    expect(() => resolveConfig({ ...valid, defaults: 3 } as never)).toThrow(
      /"defaults" must be an object of proxy defaults, got number/,
    );
    expect(() => resolveConfig({ ...valid, defaults: [] } as never)).toThrow(
      /"defaults" must be an object of proxy defaults, got array/,
    );
  });

  it("rejects a non-object logger option", () => {
    expect(() => resolveConfig({ ...valid, logger: "info" } as never)).toThrow(
      /"logger" must be an object of logger options, got string/,
    );
    expect(() => resolveConfig({ ...valid, logger: [] } as never)).toThrow(
      /"logger" must be an object of logger options, got array/,
    );
  });

  it("rejects invalid cookieRewrite / log value types", () => {
    expect(() =>
      resolveConfig({
        proxies: [{ pattern: "/api", target: "http://x.com", cookieRewrite: "yes" }],
      } as never),
    ).toThrow(/proxy\[0\]\.cookieRewrite must be a boolean or an object, got string/);
    expect(() =>
      resolveConfig({
        proxies: [{ pattern: "/api", target: "http://x.com", log: 1 }],
      } as never),
    ).toThrow(/proxy\[0\]\.log must be a boolean or an object, got number/);
  });

  it("prefixes every error with [proxy-enhancer] for greppability", () => {
    expect(() => resolveConfig({} as never)).toThrow(/^\[proxy-enhancer\] Invalid configuration:/);
    expect(() => proxyEnhancer({} as never)).toThrow(/^\[proxy-enhancer\] Invalid configuration:/);
  });

  it("accepts an empty proxies array without throwing", () => {
    expect(() => proxyEnhancer({ proxies: [] })).not.toThrow();
    expect(resolveConfig({ proxies: [] }).proxies).toEqual([]);
  });
});

describe("configuration resolution", () => {
  it("defaults changeOrigin and secure to true", () => {
    const [rule] = resolveConfig(valid).proxies;
    expect(rule.changeOrigin).toBe(true);
    expect(rule.secure).toBe(true);
  });

  it("applies PROXY_DEFAULTS < defaults < entry", () => {
    const [rule] = resolveConfig({
      defaults: { changeOrigin: false, secure: false },
      proxies: [{ pattern: "/api", target: "http://localhost:3001", changeOrigin: true }],
    }).proxies;

    expect(rule.changeOrigin).toBe(true); // entry beats defaults
    expect(rule.secure).toBe(false); // defaults beat PROXY_DEFAULTS
  });

  it("normalizes cookieRewrite (true → object, undefined → false)", () => {
    expect(
      resolveConfig({
        proxies: [{ pattern: "/api", target: "http://x.com", cookieRewrite: true }],
      }).proxies[0].cookieRewrite,
    ).toEqual({ rewriteDomain: false, rewritePath: false, secure: false, inject: {}, exclude: [] });

    expect(resolveConfig(valid).proxies[0].cookieRewrite).toBe(false);
  });

  it("merges per-entry cookieRewrite over the defaults", () => {
    const rule = resolveConfig({
      proxies: [{ pattern: "/api", target: "http://x.com", cookieRewrite: { path: "/" } }],
    }).proxies[0];

    expect(rule.cookieRewrite).toMatchObject({
      rewriteDomain: false,
      path: "/",
      inject: {},
      exclude: [],
    });
  });

  it("deep-merges nested cookieRewrite from defaults with per-entry options", () => {
    const [rule] = resolveConfig({
      defaults: { cookieRewrite: { rewriteDomain: true, path: "/" } },
      proxies: [
        {
          pattern: "/api",
          target: "http://x.com",
          cookieRewrite: { sameSite: "Lax", inject: { debug: "1" } },
        },
      ],
    }).proxies;

    expect(rule.cookieRewrite).toMatchObject({
      rewriteDomain: true, // kept from defaults
      path: "/", // kept from defaults
      sameSite: "Lax", // added per entry
      inject: { debug: "1" },
    });
  });

  it("lets an entry disable cookieRewrite set in defaults", () => {
    const [rule] = resolveConfig({
      defaults: { cookieRewrite: true },
      proxies: [{ pattern: "/api", target: "http://x.com", cookieRewrite: false }],
    }).proxies;

    expect(rule.cookieRewrite).toBe(false);
  });

  it("deep-merges nested log options from defaults with per-entry options", () => {
    const [rule] = resolveConfig({
      defaults: { log: { showBody: true } },
      proxies: [{ pattern: "/api", target: "http://x.com", log: { level: "debug" } }],
    }).proxies;

    expect(rule.log.enabled).toBe(true);
    expect(rule.log.options.showBody).toBe(true); // kept from defaults
    expect(rule.log.options.level).toBe("debug"); // added per entry
  });

  it("lets an entry disable logging set in defaults", () => {
    const [rule] = resolveConfig({
      defaults: { log: { showBody: true } },
      proxies: [{ pattern: "/api", target: "http://x.com", log: false }],
    }).proxies;

    expect(rule.log.enabled).toBe(false);
  });

  it("resolves log flags and per-entry overrides", () => {
    const resolved = resolveConfig({
      logger: { level: "warn" },
      proxies: [
        { pattern: "/a", target: "http://x.com" },
        { pattern: "/b", target: "http://x.com", log: false },
        { pattern: "/c", target: "http://x.com", log: { level: "debug" } },
      ],
    });

    expect(resolved.proxies[0].log.enabled).toBe(true);
    expect(resolved.proxies[0].log.options.level).toBe("warn"); // global logger
    expect(resolved.proxies[1].log.enabled).toBe(false);
    expect(resolved.proxies[2].log.options.level).toBe("debug"); // per-entry override
    expect(resolved.proxies[2].log.options.color).toBe(true); // other globals kept
  });

  it("passes native Vite proxy options through untouched", () => {
    const rewrite = (path: string) => path.replace(/^\/api/, "");
    const [rule] = resolveConfig({
      proxies: [
        {
          pattern: "/api",
          target: "http://x.com",
          ws: true,
          headers: { "x-extra": "1" },
          rewrite,
        },
      ],
    }).proxies;

    expect(rule.ws).toBe(true);
    expect(rule.headers).toEqual({ "x-extra": "1" });
    expect(rule.rewrite).toBe(rewrite);
  });
});
