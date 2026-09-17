// ─── Types ─────────────────────────────────────────────────────

/** The canonical pass-through values for the `SameSite` cookie attribute. */
export type SameSiteValue = "Strict" | "Lax" | "None";

/**
 * A single attribute inside a `Set-Cookie` header, e.g. `Domain=example.com` or the
 * bare `HttpOnly` flag.
 */
export interface CookieAttribute {
  /** Attribute name in canonical casing, e.g. "Domain", "HttpOnly". */
  name: string;
  /** Attribute value. "" for flag attributes like Secure / HttpOnly. */
  value: string;
  /** Original raw text of the attribute, e.g. "Domain=api.example.com". */
  raw: string;
  /** True when the attribute was introduced after parsing. */
  added?: boolean;
  /** True when the attribute value was changed after parsing. */
  modified?: boolean;
}

/** A structured, attribute-aware representation of a single cookie. */
export interface ParsedCookie {
  /** Cookie name (may already have its prefix stripped by the caller). */
  name: string;
  /** Cookie value (unquoted from the raw header). */
  value: string;
  /** Attributes in source order, e.g. Path, Domain, HttpOnly. */
  attributes: CookieAttribute[];
  /** Original header string this cookie was parsed from, if any. */
  original?: string;
  /** True when the cookie differs from its original form. */
  modified: boolean;
}

export interface CookieRewriteRule {
  /** Legacy shorthand for `removeDomain`: strip the Domain attribute so the cookie
   *  applies to whatever host the response was served from (the dev-server origin).
   *  Use `removeDomain` or `domain` for explicit control. @deprecated */
  rewriteDomain?: boolean;
  /** Legacy shorthand for `path: "/"`: set the Path attribute to `/` so the cookie
   *  applies to the whole proxied app. Use `path` for explicit control. @deprecated */
  rewritePath?: boolean;
  /** Replace the Domain attribute value, e.g. ".example.com". */
  domain?: string;
  /** Remove the Domain attribute entirely. */
  removeDomain?: boolean;
  /** Replace the Path attribute value, e.g. "/". */
  path?: string;
  /** Remove the Path attribute entirely. */
  removePath?: boolean;
  /** Ensure the Secure flag is present. */
  secure?: boolean;
  /** Remove the Secure flag. */
  removeSecure?: boolean;
  /** Ensure the HttpOnly flag is present. */
  httpOnly?: boolean;
  /** Remove the HttpOnly flag. */
  removeHttpOnly?: boolean;
  /** Replace the SameSite attribute value. */
  sameSite?: SameSiteValue;
  /** Remove the SameSite attribute. */
  removeSameSite?: boolean;
  /** Strip trailing "__Host-" and "__Secure-" prefixes from the cookie name. */
  removePrefixes?: boolean;
  /** Cookie names (exact, comparing the original name) to leave untouched. */
  exclude?: string[];
}

/**
 * Options for building a cookie from scratch via {@link serializeCookie}.
 */
export interface CookieSerializeOptions {
  /** `Domain=<value>` attribute. */
  domain?: string;
  /** `Path=<value>` attribute. */
  path?: string;
  /** `Expires=<value>` attribute (rendered as a UTC date string). */
  expires?: Date;
  /** `Max-Age=<seconds>` attribute (floored). */
  maxAge?: number;
  /** Emit the `HttpOnly` flag. */
  httpOnly?: boolean;
  /** Emit the `Secure` flag. */
  secure?: boolean;
  /** Emit `SameSite=<value>`. */
  sameSite?: SameSiteValue;
}

/** Result of {@link checkPrefixRequirements}: the detected prefix and any violations. */
export interface CookiePrefixReport {
  /** The detected prefix, or `""` for an unprefixed cookie. */
  prefix: "" | "__Host-" | "__Secure-";
  /** Human-readable descriptions of every requirement that was not met. */
  violations: string[];
}

// ─── Constants ─────────────────────────────────────────────────

const ATTR_NAMES: Record<string, string> = {
  domain: "Domain",
  path: "Path",
  expires: "Expires",
  "max-age": "Max-Age",
  secure: "Secure",
  httponly: "HttpOnly",
  samesite: "SameSite",
  partitioned: "Partitioned",
  priority: "Priority",
};

// ─── Request Cookie Header Parsing ─────────────────────────────

/**
 * Parse a `Cookie` request header into a name → value map.
 *
 * Values are unquoted. When the same name appears multiple times the last
 * occurrence wins, mirroring browser behavior.
 *
 * @example
 * parseCookies("theme=dark; session=abc123") // => { theme: "dark", session: "abc123" }
 * @param header The raw `Cookie` header value.
 * @returns A record of cookie name → cookie value.
 */
export function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = unquote(pair.slice(eq + 1).trim());
    if (name) cookies[name] = value;
  }
  return cookies;
}

// ─── Set-Cookie Parsing ────────────────────────────────────────

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function canonicalAttributeName(name: string): string {
  return ATTR_NAMES[name] ?? name;
}

function canonicalSameSiteValue(value: string): string {
  switch (value.toLowerCase()) {
    case "strict":
      return "Strict";
    case "lax":
      return "Lax";
    case "none":
      return "None";
    default:
      return value;
  }
}

function isDateSegment(value: string): boolean {
  return /^\d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT/.test(
    value.trimStart(),
  );
}

function isCookiePairStart(value: string): boolean {
  const text = value.trimStart();
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=") return i > 0;
    if (text[i] === ";") return false;
  }
  return false;
}

/**
 * Split a (possibly collapsed) `Set-Cookie` header string into individual cookie
 * strings.
 *
 * Multiple `Set-Cookie` responses get merged into a single comma-joined string by
 * some clients and servers, which makes naive `split(",")` wrong — cookie values
 * and the `Expires` attribute can contain commas. This variant only splits on
 * commas that begin a new cookie pair while tracking quoted sections.
 *
 * @param header A raw `Set-Cookie` header value.
 * @returns The individual cookie header strings.
 */
export function splitSetCookieString(header: string): string[] {
  const cookies: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < header.length; ) {
    const ch = header[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      i++;
      continue;
    }

    if (!inQuotes && ch === "," && header[i + 1] === " ") {
      const remainder = header.slice(i + 2);
      if (!isDateSegment(remainder) && isCookiePairStart(remainder)) {
        const piece = current.trim();
        if (piece) cookies.push(piece);
        current = "";
        i += 2;
        continue;
      }
    }

    current += ch;
    i++;
  }

  const piece = current.trim();
  if (piece) cookies.push(piece);
  return cookies;
}

/**
 * Parse a single `Set-Cookie` header string into a structured cookie.
 *
 * Attribute names are canonicalized (`httponly` → `HttpOnly`, `samesite` → `SameSite`, …)
 * and `SameSite` values are normalized to `Strict` / `Lax` / `None`. Returns `null`
 * for empty or malformed input (missing `name=value` pair).
 *
 * @param header A single `Set-Cookie` header string.
 * @returns The parsed cookie, or `null` if it cannot be parsed.
 */
export function parseSetCookieString(header: string): ParsedCookie | null {
  if (typeof header !== "string") return null;
  const input = header.trim();
  if (!input) return null;

  const semicolon = input.indexOf(";");
  const pair = semicolon === -1 ? input : input.slice(0, semicolon);
  const attrsText = semicolon === -1 ? "" : input.slice(semicolon);

  const eq = pair.indexOf("=");
  if (eq === -1) return null;

  const name = pair.slice(0, eq).trim();
  const value = unquote(pair.slice(eq + 1).trim());
  if (!name) return null;

  const attributes: CookieAttribute[] = [];
  const seen = new Set<string>();

  for (const chunk of attrsText.split(";")) {
    const text = chunk.trim();
    if (!text) continue;

    const aEq = text.indexOf("=");
    const aName = (aEq === -1 ? text : text.slice(0, aEq)).trim();
    let aValue = aEq === -1 ? "" : text.slice(aEq + 1).trim();
    const lower = aName.toLowerCase();

    if (!aName || seen.has(lower)) continue;
    seen.add(lower);

    if (lower === "samesite") aValue = canonicalSameSiteValue(aValue);
    attributes.push({
      name: canonicalAttributeName(aName),
      value: aValue,
      raw: text,
    });
  }

  return {
    name,
    value,
    attributes,
    original: input,
    modified: false,
  };
}

/**
 * Parse a `Set-Cookie` header into a list of structured cookies.
 *
 * Accepts a single header string (which may itself contain multiple cookies joined
 * by commas), an existing array, or nothing.
 *
 * @param input The raw `Set-Cookie` header, an array of them, or `undefined`/`null`.
 * @returns An array of parsed cookies (empty when the input is empty).
 */
export function parseSetCookieHeader(
  input: string | string[] | undefined | null,
): ParsedCookie[] {
  if (input === undefined || input === null) return [];
  const parts = Array.isArray(input) ? input : splitSetCookieString(input);
  const parsed: ParsedCookie[] = [];

  for (const part of parts) {
    if (!part) continue;
    const cookie = parseSetCookieString(part);
    if (cookie) parsed.push(cookie);
  }
  return parsed;
}

// ─── Set-Cookie Serialization ──────────────────────────────────

/**
 * Serialize a parsed cookie back into a `Set-Cookie` header string.
 *
 * Cookies whose `modified` flag is unset and that were parsed from a header
 * (`original` present) are returned byte-for-byte unchanged. Modified or newly
 * built cookies are re-emitted from their attributes.
 *
 * @param cookie The cookie to serialize.
 * @returns A single `Set-Cookie` header string.
 */
export function serializeSetCookie(cookie: ParsedCookie): string {
  if (cookie.original !== undefined && !cookie.modified) {
    return cookie.original;
  }

  let out = `${cookie.name}=${cookie.value}`;
  for (const attr of cookie.attributes) {
    let text = attr.raw;
    if (attr.added || attr.modified || attr.raw === "") {
      text = attr.name + (attr.value ? `=${attr.value}` : "");
    }
    out += `; ${text}`;
  }
  return out;
}

function toCookieDate(date: Date): string {
  return date.toUTCString();
}

/**
 * Build a `Set-Cookie` header string for a cookie not parsed from an existing header.
 *
 * Attributes are emitted in a stable order: `Max-Age`, `Expires`, `Domain`, `Path`,
 * `Secure`, `HttpOnly`, `SameSite`. Note that `secure: true` in an `http:` dev
 * server context is commonly paired with `sameSite: "None"`.
 *
 * @example
 * serializeCookie("session", "abc123", { path: "/", httpOnly: true, sameSite: "Lax" })
 * // => "session=abc123; Path=/; HttpOnly; SameSite=Lax"
 *
 * @param name The cookie name.
 * @param value The cookie value.
 * @param options Serialization options (attributes).
 * @returns A single `Set-Cookie` header string.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieSerializeOptions = {},
): string {
  const attributes: CookieAttribute[] = [];

  if (options.maxAge !== undefined) {
    attributes.push({
      name: "Max-Age",
      value: String(Math.floor(options.maxAge)),
      raw: "",
    });
  }
  if (options.expires !== undefined) {
    attributes.push({
      name: "Expires",
      value: toCookieDate(options.expires),
      raw: "",
    });
  }
  if (options.domain !== undefined) {
    attributes.push({ name: "Domain", value: options.domain, raw: "" });
  }
  if (options.path !== undefined) {
    attributes.push({ name: "Path", value: options.path, raw: "" });
  }
  if (options.secure) {
    attributes.push({ name: "Secure", value: "", raw: "" });
  }
  if (options.httpOnly) {
    attributes.push({ name: "HttpOnly", value: "", raw: "" });
  }
  if (options.sameSite !== undefined) {
    attributes.push({ name: "SameSite", value: options.sameSite, raw: "" });
  }

  return serializeSetCookie({
    name,
    value,
    attributes,
    modified: true,
  });
}

// ─── Attribute Helpers ─────────────────────────────────────────

/**
 * Look up a single attribute of a parsed cookie by name (case-insensitive).
 *
 * @param cookie The cookie to inspect.
 * @param name An attribute name, e.g. `"Domain"` or `"samesite"`.
 * @returns The matching attribute, or `undefined` when the cookie does not have it.
 */
export function getCookieAttribute(
  cookie: ParsedCookie,
  name: string,
): CookieAttribute | undefined {
  const lower = name.toLowerCase();
  return cookie.attributes.find((a) => a.name.toLowerCase() === lower);
}

// ─── Prefix Handling ───────────────────────────────────────────

/**
 * Detect the RFC-6265bis name prefix of a cookie.
 *
 * `__Host-` and `__Secure-` prefixes impose browser-enforced requirements — see
 * {@link checkPrefixRequirements}.
 *
 * @param name A cookie name.
 * @returns `"__Host-"`, `"__Secure-"`, or `""` when there is no prefix.
 */
export function getCookiePrefix(name: string): "" | "__Host-" | "__Secure-" {
  if (name.startsWith("__Host-")) return "__Host-";
  if (name.startsWith("__Secure-")) return "__Secure-";
  return "";
}

/**
 * Remove the `__Host-` / `__Secure-` prefix from a cookie name.
 *
 * Returns the name unchanged when the stripped form would be empty.
 *
 * @param name A cookie name.
 * @returns The name without its prefix.
 */
export function stripCookiePrefix(name: string): string {
  const prefix = getCookiePrefix(name);
  const stripped = prefix ? name.slice(prefix.length) : name;
  return stripped === "" ? name : stripped;
}

/**
 * Verify the browser-enforced requirements for prefixed cookies.
 *
 * A `__Secure-` cookie must carry `Secure`. A `__Host-` cookie must additionally
 * set `Path=/` and must not set a `Domain`. Vendors may silently drop cookies that
 * violate these rules, so this is useful for diagnosing "cookie never sent" issues.
 *
 * @param cookie The cookie to validate.
 * @returns A report with the detected prefix and a list of violations (empty when valid).
 */
export function checkPrefixRequirements(cookie: ParsedCookie) {
  const prefix = getCookiePrefix(cookie.name);
  const report: CookiePrefixReport = { prefix, violations: [] };

  if (prefix) {
    const hasSecure = getCookieAttribute(cookie, "secure") !== undefined;
    if (!hasSecure) {
      report.violations.push(
        `"${prefix}" prefixed cookie "${cookie.name}" MUST include the Secure attribute`,
      );
    }
    if (prefix === "__Host-") {
      const path = getCookieAttribute(cookie, "path");
      if (!path || path.value !== "/") {
        report.violations.push(
          `"__Host-" prefixed cookie "${cookie.name}" MUST set Path=/`,
        );
      }
      if (getCookieAttribute(cookie, "domain") !== undefined) {
        report.violations.push(
          `"__Host-" prefixed cookie "${cookie.name}" MUST NOT set a Domain attribute`,
        );
      }
    }
  }

  return report;
}

// ─── Rewriting ─────────────────────────────────────────────────

function findAttrIndex(
  attributes: CookieAttribute[],
  lowerName: string,
): number {
  for (let i = 0; i < attributes.length; i++) {
    if (attributes[i].name.toLowerCase() === lowerName) return i;
  }
  return -1;
}

function setAttr(
  attributes: CookieAttribute[],
  name: string,
  lowerName: string,
  value: string,
): boolean {
  const idx = findAttrIndex(attributes, lowerName);
  if (idx !== -1) {
    if (attributes[idx].value === value) return false;
    attributes[idx] = {
      ...attributes[idx],
      value,
      raw: "",
      modified: true,
    };
    return true;
  }
  attributes.push({ name, value, raw: "", added: true });
  return true;
}

function removeAttr(attributes: CookieAttribute[], lowerName: string): boolean {
  const idx = findAttrIndex(attributes, lowerName);
  if (idx === -1) return false;
  attributes.splice(idx, 1);
  return true;
}

function setFlag(
  attributes: CookieAttribute[],
  name: string,
  lowerName: string,
  on: boolean,
): boolean {
  const idx = findAttrIndex(attributes, lowerName);
  const present = idx !== -1;

  if (on && !present) {
    attributes.push({ name, value: "", raw: "", added: true });
    return true;
  }
  if (!on && present) {
    attributes.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * Rewrite a single parsed cookie according to a rewrite rule.
 *
 * Returns the input cookie unchanged (same reference) when nothing needs to change.
 * `rewriteDomain` is a deprecated shorthand for `removeDomain`, and `rewritePath` a
 * deprecated shorthand for `path: "/"` — prefer the explicit options.
 *
 * @example
 * rewriteCookie(
 *   parseSetCookieString("session=abc; Domain=api.example.com; Path=/api")!,
 *   { rewriteDomain: true, path: "/" },
 * )
 * // => "session=abc; Path=/"
 *
 * @param cookie The cookie to rewrite.
 * @param rule The rewrite rules to apply.
 * @returns The rewritten cookie (a new object when modified, input otherwise).
 */
export function rewriteCookie(
  cookie: ParsedCookie,
  rule: CookieRewriteRule,
): ParsedCookie {
  const name = rule.removePrefixes
    ? stripCookiePrefix(cookie.name)
    : cookie.name;
  const attributes = cookie.attributes.map((a) => ({ ...a }));
  let changed = name !== cookie.name;

  if (rule.removeDomain || rule.rewriteDomain) {
    changed = removeAttr(attributes, "domain") || changed;
  } else if (rule.domain !== undefined) {
    changed = setAttr(attributes, "Domain", "domain", rule.domain) || changed;
  }

  if (rule.removePath) {
    changed = removeAttr(attributes, "path") || changed;
  } else {
    const nextPath =
      rule.path !== undefined ? rule.path : rule.rewritePath ? "/" : undefined;
    if (nextPath !== undefined) {
      changed = setAttr(attributes, "Path", "path", nextPath) || changed;
    }
  }
  if (rule.removeSecure) {
    changed = setFlag(attributes, "Secure", "secure", false) || changed;
  }
  if (rule.secure === true) {
    changed = setFlag(attributes, "Secure", "secure", true) || changed;
  }
  if (rule.removeHttpOnly) {
    changed = setFlag(attributes, "HttpOnly", "httponly", false) || changed;
  }
  if (rule.httpOnly === true) {
    changed = setFlag(attributes, "HttpOnly", "httponly", true) || changed;
  }
  if (rule.removeSameSite) {
    changed = removeAttr(attributes, "samesite") || changed;
  }
  if (rule.sameSite !== undefined) {
    changed = setAttr(attributes, "SameSite", "samesite", rule.sameSite) || changed;
  }

  if (!changed) return cookie;

  return {
    ...cookie,
    name,
    attributes,
    modified: true,
  };
}

/**
 * Rewrite all cookies in a `Set-Cookie` header, preserving each one separately.
 *
 * The input may be a single (possibly collapsed) header string or an array. The
 * returned array has one entry per cookie, so multiple `Set-Cookie` headers stay
 * separate instead of being joined into one comma-separated value. Cookies listed
 * in {@link CookieRewriteRule.exclude} are passed through untouched.
 *
 * @param input The raw `Set-Cookie` header(s).
 * @param rule The rewrite rules to apply.
 * @returns One serialized header string per cookie.
 */
export function rewriteSetCookieHeaders(
  input: string | string[] | undefined | null,
  rule: CookieRewriteRule,
): string[] {
  const exclude = new Set(rule.exclude ?? []);

  return parseSetCookieHeader(input).map((cookie) => {
    if (exclude.has(cookie.name)) return serializeSetCookie(cookie);
    return serializeSetCookie(rewriteCookie(cookie, rule));
  });
}

// ─── Set-Cookie ↔ Headers Object ───────────────────────────────
//
// Set-Cookie is the designated *exceptional* header of the HTTP spec:
//
// - RFC 6265 §4.1 says every cookie is carried in its own `Set-Cookie` header
//   field, and a single field can never carry more than one cookie. It cannot be
//   folded into a comma-separated list like other headers: the `Expires`
//   attribute itself contains commas, and the cookie-value ABNF excludes the
//   comma octet. A browser parsing a comma-joined value therefore treats
//   everything after the first cookie as attributes of that cookie and silently
//   **drops the rest** — breaking multi-cookie auth flows (session + CSRF token).
// - Node.js honours this: `message.headers["set-cookie"]` is the one header kept
//   as an array, and `response.setHeader("set-cookie", [...])` writes one
//   `Set-Cookie:` line per array element. http-proxy's `writeHeaders` pass calls
//   `res.setHeader(key, proxyRes.headers[key])` verbatim, so the instant the
//   value is emitted as a comma-joined *string* the extra cookies are lost — see
//   vitejs/vite#23450 ("server.proxy fetch() drops multiple Set-Cookie response
//   headers") and mswjs/msw#640.
//
// To stay correct we therefore keep the header as a pure array end-to-end:
// extract every value (string OR string[]), rewrite each cookie independently,
// and write it back as a `string[]` — never a joined string.

/**
 * Shape of the response `headers` object of the Set-Cookie helpers below.
 * Compatible with Node's `IncomingHttpHeaders` and the headers objects passed to
 * Vite / http-proxy handlers.
 */
export interface SetCookieHeaderContainer {
  [key: string]: string | string[] | undefined;
}

function isSetCookieKey(key: string): boolean {
  return key.toLowerCase() === "set-cookie";
}

/**
 * Extract every `Set-Cookie` value from a headers object, in on-the-wire order.
 *
 * Field names are case-insensitive (RFC 7230 §3.2), and a collapsed proxy may
 * present them under any casing or as a single comma-joined string, so this reads
 * all matching keys and normalizes each value — `string` or `string[]` — into a
 * flat array of individual cookie header strings.
 *
 * @example
 * getSetCookieHeaderValues({ "set-cookie": ["a=1", "b=2"] }) // => ["a=1", "b=2"]
 * getSetCookieHeaderValues({ "Set-Cookie": "a=1, b=2" })     // => ["a=1", "b=2"]
 *
 * @param headers A raw response headers object.
 * @returns One string per cookie (empty when none were set).
 */
export function getSetCookieHeaderValues(
  headers: SetCookieHeaderContainer,
): string[] {
  const values: string[] = [];
  for (const key of Object.keys(headers)) {
    if (!isSetCookieKey(key)) continue;
    const value = headers[key];
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      // Defensively split even array entries: if an upstream proxy already
      // collapsed several cookies into one value, splitSetCookieString recovers
      // them while respecting quoted values and Date segments.
      values.push(...splitSetCookieString(entry));
    }
  }
  return values;
}

/**
 * Write cookie header strings back into a headers object as an array — never as a
 * single comma-joined string.
 *
 * Any pre-existing `set-cookie` entries (any casing) are removed first so stale
 * collapsed values can't leak through, then the value is assigned as a
 * `string[]`. Node's `ServerResponse.setHeader("set-cookie", [...])` then emits
 * one distinct `Set-Cookie` header per element, satisfying RFC 6265 §4.1. An
 * empty array removes the header entirely.
 *
 * @param headers The headers object to mutate.
 * @param values One serialized header string per cookie (from
 *   {@link rewriteSetCookieHeaders} / {@link rewriteResponseSetCookies}).
 */
export function setSetCookieHeaderValues(
  headers: SetCookieHeaderContainer,
  values: string[],
): void {
  for (const key of Object.keys(headers)) {
    if (isSetCookieKey(key)) delete headers[key];
  }
  if (values.length > 0) {
    headers["set-cookie"] = values;
  }
}

/**
 * Rewrite every cookie in a response's headers object in place, preserving each
 * one as a separate `Set-Cookie` header.
 *
 * This is the single entry point the proxy uses: it extracts all Set-Cookie
 * values (regardless of `string`/`string[]`/casing), applies {@link
 * rewriteSetCookieHeaders} — which parses and rewrites each cookie individually —
 * and writes the result back as a proper array so Node emits multiple distinct
 * headers. `CookieRewriteRule.exclude`-listed cookies pass through untouched.
 *
 * @example
 * const headers = { "set-cookie": ["session=abc; Domain=api.example.com", "csrf=xyz; Path=/api"] };
 * rewriteResponseSetCookies(headers, { rewriteDomain: true });
 * // headers["set-cookie"] => ["session=abc", "csrf=xyz; Path=/api"]
 *
 * @param headers The raw response headers object (mutated in place).
 * @param rule The rewrite rules applied to each cookie.
 * @returns The final array of `Set-Cookie` header strings (one per cookie).
 */
export function rewriteResponseSetCookies(
  headers: SetCookieHeaderContainer,
  rule: CookieRewriteRule,
): string[] {
  const extracted = getSetCookieHeaderValues(headers);
  const rewritten =
    extracted.length > 0 ? rewriteSetCookieHeaders(extracted, rule) : [];
  setSetCookieHeaderValues(headers, rewritten);
  return rewritten;
}