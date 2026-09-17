import { defineConfig } from 'vite';
import { proxyEnhancer } from 'vite-plugin-proxy-enhancer';

export default defineConfig({
  plugins: [
    proxyEnhancer({
      defaults: {
        changeOrigin: true,
        cookieRewrite: {
          rewriteDomain: true,
          rewritePath: true,
          secure: false, // For local development over HTTP
          sameSite: 'lax',
        }
      },
      proxies: [
        {
          pattern: '^/api/.*',
          target: 'https://jsonplaceholder.typicode.com',
          rewrite: (path) => path.replace(/^\/api/, ''),
          log: {
            showBody: true,
            showRequestHeaders: true
          }
        },
        {
          pattern: '/ws',
          target: 'ws://echo.websocket.events',
          ws: true,
          log: true
        }
      ]
    })
  ]
});
