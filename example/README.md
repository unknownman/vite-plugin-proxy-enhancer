# Example

A minimal, dependency-free demo of the most important `vite-plugin-proxy-enhancer`
features:

- rewriting `Domain` / `Path` / `SameSite` so cookies survive on `localhost`
- preserving multiple `Set-Cookie` headers from one response
- injecting a debug cookie into every proxied response
- excluding specific cookies from rewriting
- disabling logging for a single route
- proxying WebSocket upgrades (`ws: true`)
- coexisting with a hand-written `server.proxy` entry

## Run it

From the repository root:

```bash
# 1. Install and build the plugin (this example imports the built package).
npm install
npm run build

# 2. Start the mock backend (terminal 1)
node example/mock-api.mjs

# 3. Start the Vite dev server (terminal 2)
npx vite --config example/vite.config.ts
```

Then open <http://localhost:5173> and open the browser devtools:

- **GET `/api/login`** — the backend sets two cookies scoped to
  `Domain=api.example.com` with `SameSite=None`. Watch the Network tab: the proxy
  rewrites them to be valid on `localhost` and keeps both `Set-Cookie` headers
  separate.
- **GET `/api/users`** — logged normally; a `debug=1` cookie is injected.
- **GET `/api/health`** — works but is **not** logged (`log: false`).
- **GET `/legacy`** — served by the hand-written `server.proxy` entry, untouched.
- **WebSocket `/ws`** — completes the upgrade through the proxy.

The Vite terminal prints each request with the matched pattern, status, timing,
target, and a cookie-rewrite summary:

```
  [09:41:14] GET /api/login (/api) → 200 OK 12.4ms ⇢ http://localhost:3001
  [09:41:14] INFO     cookies rewritten: session, csrf
```

## Files

| File             | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `vite.config.ts` | Plugin configuration with `defaults`, per-rule options, `ws`.  |
| `mock-api.mjs`   | Node-only mock API that sets misbehaving cookies + WS upgrades. |
| `index.html`     | Demo page that calls each route and shows cookies.             |
