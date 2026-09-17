// Minimal dependency-free backend used by the example.
//
// It deliberately misbehaves the way real production APIs do in local
// development:
//
//   * it scopes cookies to `Domain=api.example.com`, which a browser on
//     http://localhost would reject;
//   * it emits `SameSite=None` without `Secure`, an invalid combination;
//   * it sends multiple `Set-Cookie` headers in one response.
//
// Run it, then start the Vite dev server in `example/vite.config.ts` and watch
// the plugin fix all of the above.
//
//   node example/mock-api.mjs
//
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3001);
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const users = [
  { id: 1, name: "Ada Lovelace" },
  { id: 2, name: "Grace Hopper" },
];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === "/api/health") {
    json(res, 200, { ok: true, uptime: process.uptime() });
    return;
  }

  if (pathname === "/api/login") {
    // Two cookies, both scoped to the production domain. Without rewriting the
    // browser drops them on localhost and the app never "logs in".
    res.setHeader("Set-Cookie", [
      "session=abc123; Domain=api.example.com; Path=/api; HttpOnly; SameSite=None",
      "csrf=xyz789; Domain=api.example.com; Path=/api",
    ]);
    json(res, 200, { ok: true, user: users[0] });
    return;
  }

  if (pathname === "/api/users") {
    json(res, 200, users);
    return;
  }

  if (pathname === "/legacy") {
    json(res, 200, {
      legacy: true,
      message: "Reached through your hand-written server.proxy entry.",
    });
    return;
  }

  json(res, 404, { error: `No route for ${pathname}` });
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  // Echo any frame back so the demo page can prove the tunnel works.
  socket.on("data", (chunk) => socket.write(chunk));
});

server.listen(PORT, () => {
  console.log(`Mock API listening on http://localhost:${PORT}`);
});
