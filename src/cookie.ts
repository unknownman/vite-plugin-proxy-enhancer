// ─── Types ─────────────────────────────────────────────────────

export type SameSiteValue = "Strict" | "Lax" | "None";

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

export interface ParsedCookie {
  name: string;
  value: string;
  attributes: CookieAttribute[];
  /** Original header string this cookie was parsed from, if any. */
  original?: string;
  /** True when the cookie differs from its original form. */
  modified: boolean;
}

export interface CookieRewriteRule {
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

export interface CookieSerializeOptions {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSiteValue;
}

export interface CookiePrefixReport {
  prefix: "" | "__Host-" | "__Secure-";
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

export function getCookieAttribute(
  cookie: ParsedCookie,
  name: string,
): CookieAttribute | undefined {
  const lower = name.toLowerCase();
  return cookie.attributes.find((a) => a.name.toLowerCase() === lower);
}

// ─── Prefix Handling ───────────────────────────────────────────

export function getCookiePrefix(name: string): "" | "__Host-" | "__Secure-" {
  if (name.startsWith("__Host-")) return "__Host-";
  if (name.startsWith("__Secure-")) return "__Secure-";
  return "";
}

export function stripCookiePrefix(name: string): string {
  const prefix = getCookiePrefix(name);
  const stripped = prefix ? name.slice(prefix.length) : name;
  return stripped === "" ? name : stripped;
}

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

export function rewriteCookie(
  cookie: ParsedCookie,
  rule: CookieRewriteRule,
): ParsedCookie {
  const name = rule.removePrefixes
    ? stripCookiePrefix(cookie.name)
    : cookie.name;
  const attributes = cookie.attributes.map((a) => ({ ...a }));
  let changed = name !== cookie.name;

  if (rule.removeDomain) {
    changed = removeAttr(attributes, "domain") || changed;
  }
  if (rule.domain !== undefined) {
    changed = setAttr(attributes, "Domain", "domain", rule.domain) || changed;
  }
  if (rule.removePath) {
    changed = removeAttr(attributes, "path") || changed;
  }
  if (rule.path !== undefined) {
    changed = setAttr(attributes, "Path", "path", rule.path) || changed;
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