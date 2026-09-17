import { defineConfig } from 'vite';
import { proxyEnhancer } from 'vite-plugin-proxy-enhancer';

/**
 * Example: local development against a plain HTTP backend.
 *
 * The mock backend (`mock-api.mjs`) deliberately sends production-style cookies:
 *   - Domain=api.example.com  → browser rejects on localhost
 *   - Path=/api               → cookie not sent to / routes
 *   - SameSite=None           → requires Secure, but Secure = no storage on http://
 *
 * The plugin's cookieRewrite defaults fix all three automatically.
 */
export default defineConfig({
  server: {
    // Hand-written entry — the plugin detects it and leaves it untouched.
    // It will warn if you also add /legacy to the plugin's proxies array.
    proxy: {
      "/legacy": "http://localhost:3001",
    },
  },

  plugins: [
    proxyEnhancer({
      // ── Global defaults applied to every rule ─────────────────────────
      defaults: {
        changeOrigin: true,
        cookieRewrite: {
          // ① Strip Domain= so the cookie applies to localhost instead of api.example.com
          rewriteDomain: true,
          // ② Widen Path=/api → / so the cookie is sent on all routes
          path: "/",
          // ③ Strip Secure — http://localhost is not HTTPS, browser would drop it
          secure: false,
          // ④ Replace SameSite=None with Lax (None requires Secure, which we just stripped)
          sameSite: "lax",
          // ⑤ Inject a debug cookie into every proxied response, no backend changes needed
          inject: { "x-debug": "on" },
        },
      },

      // ── Global logger ─────────────────────────────────────────────────
      logger: {
        level: "info",
        logMatches:          true,  // show which pattern matched on each line
        logCookieRewrites:   true,  // show cookie diff: rewritten / injected / unchanged
        showResponseHeaders: false, // flip to true to see Set-Cookie in the terminal
      },

      // ── Proxy rules ───────────────────────────────────────────────────
      proxies: [
        // Health check — silent (no logging noise in the terminal)
        {
          pattern: "/api/health",
          target:  "http://localhost:3001",
          log:     false,
        },

        // All other /api/* routes — logged with cookie diff
        {
          pattern: "/api",
          target:  "http://localhost:3001",
          // Inherits the global cookieRewrite defaults above.
        },

        // WebSocket echo — logged with 101 status
        {
          pattern: "/ws",
          target:  "http://localhost:3001",
          ws:      true,
        },
      ],
    }),
  ],
});
