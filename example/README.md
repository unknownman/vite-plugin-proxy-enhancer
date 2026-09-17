# Example — vite-plugin-proxy-enhancer

A fully runnable, dependency-free demonstration of the plugin's core value:
fixing cookies that would silently break on `http://localhost`.

## What this example shows

| Feature | Route |
|---|---|
| 3 misbehaving production cookies fixed for localhost | `POST /api/login` |
| Cookie round-trip (session forwarded back to backend) | `GET /api/me` |
| Cookie injection (`x-debug=on` added to every response) | `GET /api/users` |
| Logging silenced for a specific route | `GET /api/health` |
| Hand-written `server.proxy` entry coexisting with the plugin | `GET /legacy` |
| WebSocket proxying (`ws: true`) | `WS /ws` |

## Run it

From the **repository root**:

```bash
# 1. Install and build the plugin
npm install
npm run build

# 2. Start the mock backend (terminal 1)
node example/mock-api.mjs

# 3. Start Vite (terminal 2)
npx vite --config example/vite.config.ts

# 4. Open http://localhost:5173
```

## What to look for

### In the browser (DevTools → Application → Cookies)

1. Click **POST /api/login** — you should see three distinct cookies stored for
   `localhost`:
   - `session` — `Path=/`, no Domain, SameSite=Lax, no Secure
   - `csrf` — same
   - `refresh` — same
   - `x-debug=on` — injected by the plugin

   Without the plugin these would either be stored for `api.example.com` (wrong
   domain, rejected) or merged into a single broken `Set-Cookie` value.

2. Click **GET /api/me** — returns 200 because `session` was properly stored and
   the browser sent it back.

3. Click **GET /api/users** — check that `x-debug=on` appears in cookies.

### In the Vite terminal

```
[09:41:14] INFO  Configuring 3 proxy entries
[09:41:14] GET /api/login (/api) → 200 OK 12ms ⇢ http://localhost:3001
             cookies rewritten: session, csrf, refresh
             cookies injected:  x-debug
```

Health checks (`/api/health`) are silent because the rule sets `log: false`.

## Files

| File | Purpose |
|---|---|
| `vite.config.ts` | Plugin configuration with defaults, logging, and per-rule options |
| `mock-api.mjs` | Node.js mock backend — sets production-style misbehaving cookies |
| `index.html` | Interactive demo page |
| `package.json` | References the local plugin build via `file:..` |
