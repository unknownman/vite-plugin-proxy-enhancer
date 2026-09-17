import { defineConfig } from 'vite';
import { proxyEnhancer } from 'vite-plugin-proxy-enhancer';

/**
 * Example: local development against a plain HTTP backend.
 *
 * Key points:
 *  - `secure: false`   — strips the Secure flag from Set-Cookie headers.
 *                        Without this, browsers silently drop Secure cookies on
 *                        HTTP pages (http://localhost). This is the default when
 *                        cookieRewrite is enabled.
 *  - `sameSite: 'lax'` — replaces SameSite=None (which *requires* Secure and
 *                        would break on HTTP) with Lax, which works fine locally.
 *  - `rewriteDomain: true` — removes the production Domain attribute so the
 *                        cookie is scoped to localhost automatically.
 */
export default defineConfig({
  plugins: [
    proxyEnhancer({
      defaults: {
        changeOrigin: true,
        // Apply cookie fixes to every proxy rule unless overridden.
        cookieRewrite: {
          rewriteDomain: true,
          secure: false,     // Strip Secure — http://localhost is not HTTPS
          sameSite: 'lax',   // Override SameSite=None to avoid forcing Secure back
        },
      },
      proxies: [
        // ─── REST API ──────────────────────────────────────────
        {
          pattern: '^/api/.*',
          target: 'https://jsonplaceholder.typicode.com',
          rewrite: (path) => path.replace(/^\/api/, ''),
          log: {
            showBody: true,
            showRequestHeaders: true,
          },
        },
        // ─── WebSocket ─────────────────────────────────────────
        {
          pattern: '/ws',
          target: 'ws://echo.websocket.events',
          ws: true,
          log: true,
        },
      ],
    }),
  ],
});
