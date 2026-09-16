export type LogLevel = "info" | "warn" | "error" | "silent";

const PREFIX = "[proxy-enhancer]";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
  silent: 3,
};

export function createLogger(level: LogLevel = "info") {
  const minPriority = LEVEL_PRIORITY[level];

  return {
    info(msg: string) {
      if (minPriority <= LEVEL_PRIORITY.info) {
        console.log(`${PREFIX} ${msg}`);
      }
    },
    warn(msg: string) {
      if (minPriority <= LEVEL_PRIORITY.warn) {
        console.warn(`${PREFIX} ${msg}`);
      }
    },
    error(msg: string) {
      if (minPriority <= LEVEL_PRIORITY.error) {
        console.error(`${PREFIX} ${msg}`);
      }
    },
  };
}
