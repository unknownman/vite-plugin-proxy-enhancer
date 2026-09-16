export function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.split("=");
    const value = rest.join("=").trim();
    if (key) {
      cookies[key.trim()] = value;
    }
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options?: { path?: string; httpOnly?: boolean; secure?: boolean },
): string {
  let cookie = `${name}=${value}`;
  if (options?.path) cookie += `; Path=${options.path}`;
  if (options?.httpOnly) cookie += "; HttpOnly";
  if (options?.secure) cookie += "; Secure";
  return cookie;
}
