import { describe, expect, it } from "vitest";
import {
  checkPrefixRequirements,
  getCookieAttribute,
  getCookiePrefix,
  getSetCookieHeaderValues,
  injectResponseCookies,
  parseCookies,
  parseSetCookieString,
  rewriteCookie,
  rewriteCookieString,
  rewriteResponseSetCookies,
  rewriteSetCookieHeaders,
  serializeCookie,
  serializeSetCookie,
  setSetCookieHeaderValues,
  splitSetCookieString,
  stripCookiePrefix,
} from "../src/index";
import type { Headers } from "./helpers";

function parse(header: string) {
  const cookie = parseSetCookieString(header);
  if (!cookie) throw new Error(`failed to parse: ${header}`);
  return cookie;
}

// ─── 1. Multiple Set-Cookie headers are kept separate ──────────────

describe("multiple Set-Cookie headers", () => {
  it("rewrites every cookie and keeps them as separate header values", () => {
    const headers: Headers = {
      "set-cookie": [
        "session=abc; Domain=api.example.com; Path=/api",
        "csrf=xyz; Domain=api.example.com; Path=/api",
      ],
    };

    const out = rewriteResponseSetCookies(headers, {
      rewriteDomain: true,
      path: "/",
    });

    expect(out).toEqual(["session=abc; Path=/", "csrf=xyz; Path=/"]);
    expect(headers["set-cookie"]).toEqual(out);
    expect(Array.isArray(headers["set-cookie"])).toBe(true);
  });

  it("recovers cookies collapsed into one comma-joined header", () => {
    expect(getSetCookieHeaderValues({ "Set-Cookie": "a=1; Path=/, b=2; Path=/" })).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });

  it("handles Set-Cookie under any casing and string/array values", () => {
    expect(getSetCookieHeaderValues({ "SET-COOKIE": "a=1" })).toEqual(["a=1"]);
    expect(getSetCookieHeaderValues({ "set-cookie": ["a=1", "b=2"] })).toEqual(["a=1", "b=2"]);
    expect(getSetCookieHeaderValues({})).toEqual([]);
  });

  it("writes back an array, never a comma-joined string", () => {
    const headers: Headers = {};
    setSetCookieHeaderValues(headers, ["a=1", "b=2"]);
    expect(headers["set-cookie"]).toEqual(["a=1", "b=2"]);
    expect(typeof headers["set-cookie"]).not.toBe("string");
  });

  it("drops the header entirely for an empty list", () => {
    const headers: Headers = { "set-cookie": ["a=1"] };
    setSetCookieHeaderValues(headers, []);
    expect(headers).not.toHaveProperty("set-cookie");
  });

  it("splits on commas only where a new cookie begins", () => {
    expect(
      splitSetCookieString("a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT, b=2"),
    ).toEqual(["a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT", "b=2"]);
  });
});

// ─── 2. Domain / Path / SameSite / Secure rewriting ───────────────

describe("domain, path, SameSite and flag rewriting", () => {
  it("removes, replaces, or strips the Domain attribute", () => {
    expect(rewriteCookieString("s=1; Domain=api.example.com; Path=/", { removeDomain: true })).toBe(
      "s=1; Path=/",
    );
    expect(
      rewriteCookieString("s=1; Domain=api.example.com; Path=/", { domain: ".example.com" }),
    ).toBe("s=1; Domain=.example.com; Path=/");
    expect(rewriteCookieString("s=1; Domain=api.example.com", { rewriteDomain: true })).toBe("s=1");
  });

  it("sets, rewrites and removes Path", () => {
    expect(rewriteCookieString("s=1; Path=/api", { path: "/" })).toBe("s=1; Path=/");
    expect(rewriteCookieString("s=1; Path=/api; HttpOnly", { removePath: true })).toBe(
      "s=1; HttpOnly",
    );
    expect(rewriteCookieString("s=1; Path=/api", { rewritePath: true })).toBe("s=1; Path=/");
  });

  it("replaces and canonicalizes SameSite", () => {
    expect(rewriteCookieString("s=1; SameSite=lax", { sameSite: "Strict" })).toBe(
      "s=1; SameSite=Strict",
    );
    expect(rewriteCookieString("s=1; SameSite=Lax", { removeSameSite: true })).toBe("s=1");
  });

  it("adds and removes the Secure / HttpOnly flags", () => {
    expect(rewriteCookieString("s=1", { secure: true })).toBe("s=1; Secure");
    // removeSecure actively strips the flag
    expect(rewriteCookieString("s=1; Secure", { removeSecure: true })).toBe("s=1");
    // secure: false is equivalent to removeSecure — the smart default for HTTP dev
    expect(rewriteCookieString("s=1; Secure", { secure: false })).toBe("s=1");
    // If no Secure flag exists, secure: false is a no-op
    expect(rewriteCookieString("s=1", { secure: false })).toBe("s=1");
    expect(rewriteCookieString("s=1", { httpOnly: true })).toBe("s=1; HttpOnly");
    expect(rewriteCookieString("s=1; HttpOnly", { removeHttpOnly: true })).toBe("s=1");
  });

  it("forces Secure back on when SameSite=None even if secure: false is set", () => {
    // removeSecure cannot defeat the SameSite=None invariant
    expect(rewriteCookieString("s=1; SameSite=None; Secure", { removeSecure: true })).toBe(
      "s=1; SameSite=None; Secure",
    );
    // secure: false cannot defeat the invariant either
    expect(rewriteCookieString("s=1; SameSite=None; Secure", { secure: false })).toBe(
      "s=1; SameSite=None; Secure",
    );
    // Setting sameSite=None adds Secure automatically, even with secure: false
    expect(rewriteCookieString("s=1", { sameSite: "None", secure: false })).toBe(
      "s=1; SameSite=None; Secure",
    );
    expect(rewriteCookieString("s=1; SameSite=None", { sameSite: "None" })).toBe(
      "s=1; SameSite=None; Secure",
    );
  });

  it("lets removeX win over x", () => {
    expect(
      rewriteCookieString("s=1; Domain=a.com; Path=/api", {
        removeDomain: true,
        domain: "b.com",
        removePath: true,
        path: "/",
      }),
    ).toBe("s=1");
  });

  it("preserves attribute order for a no-op rewrite", () => {
    const header = "s=1; Max-Age=3600; Domain=.com; Path=/api/admin; HttpOnly";
    expect(rewriteCookieString(header, {})).toBe(header);
  });

  it("rewrites each cookie in a header list independently", () => {
    expect(
      rewriteSetCookieHeaders(["a=1; Domain=a.com", "b=2; Domain=b.com"], { rewriteDomain: true }),
    ).toEqual(["a=1", "b=2"]);
  });
});

// ─── 3. __Host- / __Secure- prefix handling ───────────────────────

describe("__Host- / __Secure- prefixes", () => {
  it("detects and strips prefixes", () => {
    expect(getCookiePrefix("__Host-a")).toBe("__Host-");
    expect(getCookiePrefix("__Secure-a")).toBe("__Secure-");
    expect(getCookiePrefix("a")).toBe("");
    expect(stripCookiePrefix("__Host-a")).toBe("a");
    expect(stripCookiePrefix("a")).toBe("a");
  });

  it("reports violations for invalid prefixed cookies", () => {
    const host = checkPrefixRequirements(parse("__Host-a=1"));
    expect(host.prefix).toBe("__Host-");
    expect(host.violations).toHaveLength(2);

    const valid = checkPrefixRequirements(parse("__Host-a=1; Path=/; Secure"));
    expect(valid.violations).toEqual([]);

    const secure = checkPrefixRequirements(parse("__Secure-a=1"));
    expect(secure.violations).toHaveLength(1);
    expect(secure.violations[0]).toContain("MUST include the Secure attribute");
  });

  it("leaves a valid __Host- cookie untouched", () => {
    expect(rewriteCookieString("__Host-a=1; Path=/; Secure", {})).toBe("__Host-a=1; Path=/; Secure");
  });

  it("strips __Host- when a Domain is set", () => {
    expect(rewriteCookieString("__Host-a=1; Path=/; Secure", { domain: ".example.com" })).toBe(
      "a=1; Path=/; Secure; Domain=.example.com",
    );
  });

  it("strips __Host- when Path leaves /", () => {
    expect(rewriteCookieString("__Host-a=1; Path=/; Secure", { path: "/api" })).toBe(
      "a=1; Path=/api; Secure",
    );
  });

  it("always keeps Secure on __Secure- cookies", () => {
    expect(
      rewriteCookieString("__Secure-a=1; Path=/; Secure", { removeSecure: true, path: "/x" }),
    ).toBe("__Secure-a=1; Path=/x; Secure");
  });

  it("strips prefixes explicitly with removePrefixes", () => {
    expect(rewriteCookieString("__Secure-a=1; Secure", { removePrefixes: true })).toBe("a=1; Secure");
  });
});

// ─── 4. Cookie injection ──────────────────────────────────────────

describe("cookie injection", () => {
  it("appends injected cookies while keeping the existing ones", () => {
    const headers: Headers = { "set-cookie": ["session=abc; Path=/"] };
    const out = injectResponseCookies(headers, { flag: "on" }, { path: "/", httpOnly: true });

    expect(out).toEqual(["session=abc; Path=/", "flag=on; Path=/; HttpOnly"]);
    expect(headers["set-cookie"]).toEqual(out);
  });

  it("injects into a response that had no cookies", () => {
    const headers: Headers = {};
    expect(injectResponseCookies(headers, { a: "1", b: "2" }, { path: "/" })).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });

  it("forces Secure on injected SameSite=None cookies", () => {
    expect(injectResponseCookies({}, { s: "1" }, { sameSite: "None" })).toEqual([
      "s=1; Secure; SameSite=None",
    ]);
  });

  it("returns existing cookies unchanged when nothing is injected", () => {
    const headers: Headers = { "set-cookie": ["a=1; Path=/"] };
    expect(injectResponseCookies(headers, {}, {})).toEqual(["a=1; Path=/"]);
  });

  it("builds cookies with a stable attribute order", () => {
    expect(
      serializeCookie("s", "1", {
        maxAge: 3600,
        domain: ".x.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      }),
    ).toBe("s=1; Max-Age=3600; Domain=.x.com; Path=/; Secure; HttpOnly; SameSite=Lax");
  });
});

// ─── 5. exclude list ──────────────────────────────────────────────

describe("exclude list", () => {
  it("leaves excluded cookies byte-for-byte untouched", () => {
    const input = [
      "keep=1; Domain=api.example.com; Path=/api",
      "change=2; Domain=api.example.com; Path=/api",
    ];
    expect(
      rewriteSetCookieHeaders(input, { rewriteDomain: true, path: "/", exclude: ["keep"] }),
    ).toEqual(["keep=1; Domain=api.example.com; Path=/api", "change=2; Path=/"]);
  });

  it("is honored by rewriteResponseSetCookies", () => {
    const headers: Headers = {
      "set-cookie": ["keep=1; Path=/api", "change=2; Path=/api"],
    };
    expect(rewriteResponseSetCookies(headers, { path: "/", exclude: ["keep"] })).toEqual([
      "keep=1; Path=/api",
      "change=2; Path=/",
    ]);
  });
});

// ─── Parsing edge cases ───────────────────────────────────────────

describe("parsing edge cases", () => {
  it("handles quoted values containing semicolons", () => {
    const cookie = parse('session="a=b;c"; Path=/');
    expect(cookie.value).toBe("a=b;c");
    expect(cookie.quoted).toBe(true);
    expect(rewriteCookieString('session="a=b;c"; Path=/', { path: "/x" })).toBe(
      'session="a=b;c"; Path=/x',
    );
  });

  it("returns unparseable input unchanged", () => {
    expect(rewriteCookieString("not-a-cookie", {})).toBe("not-a-cookie");
    expect(parseSetCookieString("")).toBeNull();
    expect(parseSetCookieString("no-equals")).toBeNull();
  });

  it("parses request Cookie headers and unquotes values", () => {
    expect(parseCookies('theme=dark; session="abc123"')).toEqual({
      theme: "dark",
      session: "abc123",
    });
    expect(parseCookies("")).toEqual({});
  });

  it("exposes attribute lookup and low-level serialization", () => {
    const cookie = parse("s=1; Domain=.x.com; Secure");
    expect(getCookieAttribute(cookie, "domain")?.value).toBe(".x.com");
    expect(getCookieAttribute(cookie, "missing")).toBeUndefined();
    expect(serializeSetCookie(cookie)).toBe("s=1; Domain=.x.com; Secure");
    expect(rewriteCookie(cookie, {})).toBe(cookie);
  });
});
