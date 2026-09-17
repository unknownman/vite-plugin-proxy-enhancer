# Render with: vhs demo.tape
# Fully self-contained demo of vite-plugin-proxy-enhancer
# Recommended for README

Output demo.gif

# ─── Terminal Settings ──────────────────────────────────────────────────────
Set Theme "Catppuccin Mocha"
Set FontSize 17
Set Width 1300
Set Height 820
Set Shell "zsh"
Set TypingSpeed 35ms
Set Padding 20

# ─── 0. Intro: clean canvas ─────────────────────────────────────────────────
Hide
Type "clear"
Enter
Show
Sleep 500ms

# ─── 1. Bootstrap project ───────────────────────────────────────────────────
Type "mkdir proxy-demo && cd proxy-demo"
Sleep 200ms
Enter
Sleep 300ms

Type "npm create vite@latest . -- --template vanilla-ts --yes 2>&1 | tail -4"
Enter
Sleep 5s

Type "npm install --silent"
Enter
Sleep 8s

Type "npm install -D vite-plugin-proxy-enhancer --silent"
Enter
Sleep 6s

Type "echo '✓ Setup complete'"
Enter
Sleep 1s
Type "clear"
Enter
Sleep 300ms

# ─── 2. Write the config ─────────────────────────────────────────────────────
Type "# Write vite.config.ts with our proxy config"
Sleep 300ms
Enter
Sleep 200ms

Type "cat > vite.config.ts << 'EOF'"
Enter
Type "import { defineConfig } from 'vite';"
Enter
Type "import { proxyEnhancer } from 'vite-plugin-proxy-enhancer';"
Enter
Enter
Type "export default defineConfig({"
Enter
Type "  plugins: ["
Enter
Type "    proxyEnhancer({"
Enter
Enter
Type "      // Applied to every rule below"
Enter
Type "      defaults: {"
Enter
Type "        changeOrigin: true,"
Enter
Type "        cookieRewrite: {"
Enter
Type "          rewriteDomain: true,   // strip Domain=api.example.com → localhost"
Enter
Type "          path:          '/',    // broaden Path=/api → /"
Enter
Type "          secure:        false,  // drop Secure for plain http://localhost"
Enter
Type "          sameSite:      'lax',  // override SameSite=None (needs Secure)"
Enter
Type "          inject: { 'x-debug': 'on' }, // inject debug cookie"
Enter
Type "        },"
Enter
Type "      },"
Enter
Enter
Type "      logger: {"
Enter
Type "        level:             'info',"
Enter
Type "        logCookieRewrites: true,   // show cookie diff per request"
Enter
Type "        showResponseHeaders: true, // show Set-Cookie in logs"
Enter
Type "        logMatches: true,"
Enter
Type "      },"
Enter
Enter
Type "      proxies: ["
Enter
Type "        {"
Enter
Type "          pattern: '/api',                    // /api/** → backend"
Enter
Type "          target:  'http://localhost:3001',"
Enter
Type "        },"
Enter
Type "        {"
Enter
Type "          pattern: '/api/health',             // health check — silent"
Enter
Type "          target:  'http://localhost:3001',"
Enter
Type "          log:     false,"
Enter
Type "        },"
Enter
Type "      ],"
Enter
Type "    }),"
Enter
Type "  ],"
Enter
Type "});"
Enter
Type "EOF"
Enter
Sleep 1s

Type "echo '✓ vite.config.ts written'"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 300ms

# ─── 3. Show the config ──────────────────────────────────────────────────────
Type "cat vite.config.ts"
Enter
Sleep 4s
Type "clear"
Enter
Sleep 300ms

# ─── 4. Start the mock backend ───────────────────────────────────────────────
Type "# Start the mock backend that returns production-style cookies"
Enter
Sleep 300ms

Type "cat > backend.mjs << 'EOF'"
Enter
Type "import { createServer } from 'node:http';"
Enter
Type "const s = createServer((req, res) => {"
Enter
Type "  if (req.url === '/api/login') {"
Enter
Type "    // Production cookies — Domain + SameSite=None intentionally misbehave on localhost"
Enter
Type "    res.setHeader('Set-Cookie', ["
Enter
Type "      'session=abc123; Domain=api.example.com; Path=/api; HttpOnly; SameSite=None',"
Enter
Type "      'csrf=xyz789; Domain=api.example.com; Path=/api',"
Enter
Type "      'refresh=tok999; Domain=api.example.com; Path=/api; HttpOnly',"
Enter
Type "    ]);"
Enter
Type "    res.writeHead(200, { 'content-type': 'application/json' });"
Enter
Type "    return res.end(JSON.stringify({ ok: true, user: 'alice' }));"
Enter
Type "  }"
Enter
Type "  res.writeHead(200, { 'content-type': 'application/json' });"
Enter
Type "  res.end(JSON.stringify({ ok: true }));"
Enter
Type "});"
Enter
Type "s.listen(3001, () => console.log('Backend: http://localhost:3001'));"
Enter
Type "EOF"
Enter
Sleep 500ms

Type "node backend.mjs &"
Enter
Sleep 2s

Type "echo '✓ Backend running on :3001'"
Enter
Sleep 1s
Type "clear"
Enter
Sleep 300ms

# ─── 5. Start Vite dev server ────────────────────────────────────────────────
Type "# Starting Vite dev server — watch the plugin configure itself"
Enter
Sleep 500ms
Type "npx vite --port 5173 &"
Enter
Sleep 5s
Type "clear"
Enter
Sleep 300ms

# ─── 6. curl WITHOUT the plugin (raw) ───────────────────────────────────────
Type "# ═══ WITHOUT the plugin: raw backend response ═══"
Enter
Sleep 500ms
Type "curl -s -D - http://localhost:3001/api/login | grep -i 'set-cookie'"
Enter
Sleep 2s

Type "# ↑  3 separate Set-Cookie lines — correct! But what reaches the browser?"
Enter
Sleep 2s
Type "clear"
Enter
Sleep 300ms

# ─── 7. curl THROUGH the Vite proxy ─────────────────────────────────────────
Type "# ═══ THROUGH vite-plugin-proxy-enhancer ═══"
Enter
Sleep 500ms
Type "curl -s -D - http://localhost:5173/api/login | grep -i 'set-cookie'"
Enter
Sleep 3s

Type ""
Enter
Type "# ✓ All 3 cookies preserved  ✓ Domain stripped  ✓ SameSite=Lax  ✓ Secure gone"
Enter
Sleep 3s
Type "clear"
Enter
Sleep 300ms

# ─── 8. Full headers (the money shot) ───────────────────────────────────────
Type "# Full response headers — every cookie is its own header field"
Enter
Sleep 500ms
Type "curl -s -I http://localhost:5173/api/login"
Enter
Sleep 3500ms
Type "clear"
Enter
Sleep 300ms

# ─── 9. Injected debug cookie ────────────────────────────────────────────────
Type "# Cookie injection — x-debug=on added to every response"
Enter
Sleep 500ms
Type "curl -s -I http://localhost:5173/api/login | grep 'x-debug'"
Enter
Sleep 2s
Sleep 2s
Type "clear"
Enter
Sleep 300ms

# ─── 10. Outro ───────────────────────────────────────────────────────────────
Type "echo ''"
Enter
Type "echo '  ✓  Multiple Set-Cookie headers preserved'"
Enter
Sleep 300ms
Type "echo '  ✓  Domain / Path / SameSite / Secure rewritten for localhost'"
Enter
Sleep 300ms
Type "echo '  ✓  Debug cookie injected automatically'"
Enter
Sleep 300ms
Type "echo '  ✓  Zero extra dependencies — pure Vite plugin'"
Enter
Sleep 300ms
Type "echo ''"
Enter
Sleep 300ms
Type "echo '  npm i -D vite-plugin-proxy-enhancer'"
Enter
Sleep 4s
