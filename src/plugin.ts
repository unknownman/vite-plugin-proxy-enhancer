import type { Plugin, ResolvedConfig as ViteResolvedConfig } from "vite";
import type { PluginOptions, ResolvedConfig } from "./types";
import { resolveConfig } from "./config";
import { createLogger, type LogLevel } from "./logger";

export function proxyEnhancer(options: PluginOptions): Plugin {
  const resolved: ResolvedConfig = resolveConfig(options);
  const logger = createLogger(resolved.logger.level as LogLevel);

  let viteConfig: ViteResolvedConfig;

  return {
    name: "vite-plugin-proxy-enhancer",

    configResolved(c) {
      viteConfig = c;
      logger.info(
        `Initialized with ${resolved.proxies.length} proxy entr${resolved.proxies.length === 1 ? "y" : "ies"}`,
      );
    },

    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        next();
      });
    },
  };
}
