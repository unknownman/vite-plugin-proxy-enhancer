/**
 * Mock backend that deliberately misbehaves — exactly like a real production API
 * does when you hit it from http://localhost during development.
 *
 * Problems it creates on purpose:
 *   1. Cookies scoped to Domain=api.example.com  → rejected by localhost
 *   2. SameSite=None without Secure               → browser drops the cookie
 *   3. Three Set-Cookie headers in one response   → plain proxies mangle them
 *   4. Cookies scoped to Path=/api                → not sent to / routes
 *
 * vite-plugin-proxy-enhancer fixes all four automatically.
 *
 * Run:  node example/mock-api.mjs
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3001);
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const USERS = [
  { id: 1, name: "Ada Lovelace",  role: "admin" },
  { id: 2, name: "Grace Hopper", role: "user" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function log(method, pathname, status) {
  const color = status >= 400 ? "\x1b[31m" : "\x1b[32m";
  const reset = "\x1b[0m";
  console.log(`  ${color}${status}${reset}  ${method} ${pathname}`);
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // GET /api/health — no cookies
  if (pathname === "/api/health") {
    log(req.method, pathname, 200);
    json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    return;
  }

  // POST /api/login — three misbehaving cookies
  if (pathname === "/api/login") {
    res.setHeader("Set-Cookie", [
      // Cookie 1: auth session — Domain + Path scoped to production, SameSite=None
      //   Without the plugin → rejected by localhost (Domain mismatch) and
      //   the browser flags SameSite=None as invalid (needs Secure).
      "session=abc123; Domain=api.example.com; Path=/api; HttpOnly; SameSite=None",

      // Cookie 2: CSRF token — same Domain/Path problem
      "csrf=xyz789; Domain=api.example.com; Path=/api",

      // Cookie 3: refresh token — HttpOnly + scoped to production domain
      "refresh=tok999; Domain=api.example.com; Path=/api; HttpOnly; Max-Age=604800",
    ]);
    log(req.method, pathname, 200);
    json(res, 200, { ok: true, user: USERS[0] });
    return;
  }

  // GET /api/users — simple list (no cookies)
  if (pathname === "/api/users") {
    log(req.method, pathname, 200);
    json(res, 200, USERS);
    return;
  }

  // GET /api/me — checks the session cookie (simulates a real auth check)
  if (pathname === "/api/me") {
    const cookie = req.headers.cookie ?? "";
    if (!cookie.includes("session=")) {
      log(req.method, pathname, 401);
      json(res, 401, { error: "Not authenticated" });
      return;
    }
    log(req.method, pathname, 200);
    json(res, 200, USERS[0]);
    return;
  }

  // GET /legacy — reachable via the hand-written server.proxy entry
  if (pathname === "/legacy") {
    log(req.method, pathname, 200);
    json(res, 200, { legacy: true, message: "Reached through server.proxy (no plugin needed here)." });
    return;
  }

  log(req.method, pathname, 404);
  json(res, 404, { error: `No route for ${pathname}` });
});

// ─── WebSocket echo server ─────────────────────────────────────────────────────

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  // Echo every WebSocket frame back so the demo page can verify the tunnel works.
  socket.on("data", (chunk) => socket.write(chunk));
  console.log("  WS   /ws  → echo connected");
});

server.listen(PORT, () => {
  console.log(`\n\x1b[32m✓\x1b[0m Mock API listening on \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log("  Routes:");
  console.log("    GET  /api/health    → 200, no cookies");
  console.log("    POST /api/login     → 200, 3 misbehaving Set-Cookie headers");
  console.log("    GET  /api/users     → 200, user list");
  console.log("    GET  /api/me        → 200/401, reads session cookie");
  console.log("    GET  /legacy        → 200, via server.proxy");
  console.log("    WS   /ws            → echo WebSocket\n");
});
