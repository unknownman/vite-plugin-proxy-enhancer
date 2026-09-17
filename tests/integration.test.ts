import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import type { IncomingHttpHeaders } from "node:http";
import { proxyEnhancer } from "../src/index";

let backend: http.Server | undefined;
let vite: ViteDevServer | undefined;
let backendPort = 0;
let vitePort = 0;
const upgradedSockets = new Set<Duplex>();

function closeAllConnections(server: unknown): void {
  (server as { closeAllConnections?: () => void } | null | undefined)
    ?.closeAllConnections?.();
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "localhost", resolve));
}

function closeServer(server: http.Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
  });
}

function get(
  port: number,
  path: string,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "localhost", port, path, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
      );
    });
    req.on("error", reject);
  });
}

/** Perform a raw WebSocket upgrade handshake and return the server's HTTP reply. */
function upgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "localhost", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: localhost:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });

    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("WebSocket upgrade timed out"));
    }, 5000);

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(data);
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

beforeAll(async () => {
  backend = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/bad")) {
      // Node allows arbitrary Set-Cookie values, including unparseable ones.
      res.setHeader("Set-Cookie", ["totally malformed", "=;=;=", "ok=1; Path=/api"]);
      res.end("bad");
      return;
    }
    res.setHeader("Set-Cookie", [
      "session=abc; Domain=api.example.com; Path=/api; SameSite=None",
      "csrf=xyz; Domain=api.example.com; Path=/api",
    ]);
    res.end("ok");
  });
  backend.on("upgrade", (_req, socket) => {
    // Upgraded sockets are detached from the HTTP server, so track them to be
    // able to tear the server down (closeAllConnections() ignores them).
    upgradedSockets.add(socket);
    socket.on("close", () => upgradedSockets.delete(socket));
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n\r\n",
    );
  });
  await listen(backend);
  backendPort = (backend.address() as AddressInfo).port;

  vite = await createServer({
    root: fileURLToPath(new URL("./fixtures/app", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "localhost" },
    plugins: [
      proxyEnhancer({
        logger: { level: "silent" },
        proxies: [
          {
            pattern: "/api",
            target: `http://localhost:${backendPort}`,
            cookieRewrite: { rewriteDomain: true, path: "/", inject: { flag: "on" } },
          },
          { pattern: "/ws", target: `http://localhost:${backendPort}`, ws: true },
        ],
      }),
    ],
  });
  await vite.listen();
  vitePort = (vite.httpServer!.address() as AddressInfo).port;
});

afterAll(async () => {
  // Force-close keep-alive and (detached) upgraded sockets so close() resolves.
  for (const socket of upgradedSockets) socket.destroy();
  upgradedSockets.clear();
  closeAllConnections(vite?.httpServer);
  await vite?.close();
  closeAllConnections(backend);
  await closeServer(backend);
});

describe("real Vite dev-server proxy", () => {
  it("preserves multiple Set-Cookie headers on the wire", async () => {
    const res = await get(vitePort, "/api/users");

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toEqual([
      "session=abc; Path=/; SameSite=None; Secure",
      "csrf=xyz; Path=/",
      "flag=on; Path=/",
    ]);
  });

  it("does not crash on malformed Set-Cookie headers", async () => {
    const res = await get(vitePort, "/api/bad");

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toEqual(["ok=1; Path=/", "flag=on; Path=/"]);
  });

  it("proxies WebSocket upgrades", async () => {
    const response = await upgrade(vitePort, "/ws");
    expect(response).toContain("101 Switching Protocols");
  });
});
