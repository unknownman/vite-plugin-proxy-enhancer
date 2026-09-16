import pc from "picocolors";
import { STATUS_CODES } from "node:http";
import type { LoggerOptions, LogLevel } from "./types";

export type LogStream = Pick<Console, "log" | "warn" | "error">;

export type HeadersLike = Record<string, string | string[] | undefined>;

export interface ProxyLogRequest {
  method: string;
  url: string;
  target: string;
  pattern?: string;
  headers?: HeadersLike;
}

export interface ProxyLogResponse {
  statusCode: number;
  headers?: HeadersLike;
  body?: string;
}

export interface ProxyLogHandle {
  /** Complete the request log. Pass the proxied response (or nothing on failure). */
  end(response?: ProxyLogResponse): void;
}

export interface Logger {
  enabled: boolean;
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Start logging a proxied request. The returned handle prints on completion. */
  request(info: ProxyLogRequest): ProxyLogHandle;
}

export const LOGGER_DEFAULTS: Required<LoggerOptions> = {
  level: "info",
  color: true,
  showRequestHeaders: false,
  showResponseHeaders: false,
  showBody: false,
  logMatches: false,
  logCookieRewrites: false,
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: Infinity,
};

type Paint = (text: string) => string;

const COLOR_METHODS = [
  "bold",
  "dim",
  "italic",
  "underline",
  "inverse",
  "hidden",
  "strikethrough",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "bgRed",
  "bgGreen",
  "bgYellow",
  "bgBlue",
  "bgMagenta",
  "bgCyan",
  "bgWhite",
] as const;

type ColorSet = Record<(typeof COLOR_METHODS)[number], Paint>;

function createColorSet(enabled: boolean): ColorSet {
  const noop: Paint = (text) => text;
  const set = {} as ColorSet;
  for (const name of COLOR_METHODS) {
    set[name] = enabled ? (pc[name] as Paint) : noop;
  }
  return set;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function now(): string {
  const d = new Date();
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
}

const BODY_LIMIT = 2000;

const SLOW_MS = 1000;

export function createLogger(
  options?: LoggerOptions,
  stream: LogStream = console,
): Logger {
  const opts: Required<LoggerOptions> = { ...LOGGER_DEFAULTS, ...options };
  const useColor = opts.color && pc.isColorSupported;
  const c = createColorSet(useColor);

  const threshold = LEVEL_ORDER[opts.level];
  const ready = (level: LogLevel): boolean => LEVEL_ORDER[level] >= threshold;

  const levelBadge: Record<Exclude<LogLevel, "silent">, Paint> = {
    trace: c.gray,
    debug: c.magenta,
    info: c.blue,
    warn: c.yellow,
    error: c.red,
  };

  function badge(level: Exclude<LogLevel, "silent">): string {
    return levelBadge[level](level.toUpperCase().padEnd(5));
  }

  function statusPaint(code: number): Paint {
    if (code >= 500) return c.red;
    if (code >= 400) return c.yellow;
    if (code >= 300) return c.cyan;
    if (code >= 200) return c.green;
    return c.white;
  }

  function statusLabel(code: number): string {
    const reason = STATUS_CODES[code];
    const paint = statusPaint(code);
    return reason === undefined ? paint(String(code)) : `${paint(String(code))} ${c.gray(reason)}`;
  }

  const methodPaint: Record<string, Paint> = {
    GET: c.green,
    HEAD: c.green,
    OPTIONS: c.gray,
    POST: c.blue,
    PATCH: c.blue,
    PUT: c.yellow,
    DELETE: c.red,
  };

  function duration(ms: number): string {
    const text = ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
    return ms >= SLOW_MS ? c.magenta(text) : c.gray(text);
  }

  function formatHeaders(headers: HeadersLike | undefined): string {
    if (!headers) return "";
    const lines: string[] = [];
    for (const key of Object.keys(headers)) {
      const value = headers[key];
      if (value === undefined) continue;
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      lines.push(`      ${c.yellow(key)}${c.gray(":")} ${c.white(text)}`);
    }
    return lines.join("\n");
  }

  function formatBody(body: string): string {
    if (body.length > BODY_LIMIT) {
      const head = body.slice(0, BODY_LIMIT);
      const tail = c.gray(`… ${body.length - BODY_LIMIT} more bytes`);
      return `      ${c.white(head)}${tail}`;
    }
    return `      ${c.white(body)}`;
  }

  function emit(level: Exclude<LogLevel, "silent">, message: string): void {
    if (!ready(level)) return;
    const line = `${now()} ${badge(level)} ${message}`;
    if (level === "warn") stream.warn(line);
    else if (level === "error") stream.error(line);
    else stream.log(line);
  }

  function buildRequestLog(
    info: ProxyLogRequest,
    response: ProxyLogResponse | undefined,
    ms: number,
  ): [string, string] {
    const method = (methodPaint[info.method.toUpperCase()] ?? c.white)(info.method.toUpperCase());
    const url = c.cyan(info.url);
    const arrow = c.gray("→");
    const target = c.dim(`⇢ ${info.target}`);
    const status =
      response === undefined
        ? `${c.red("ERROR")} ${c.gray("no response")}`
        : statusLabel(response.statusCode);
    const head = `${method} ${url} ${arrow} ${status} ${duration(ms)} ${target}`;

    const details: string[] = [];
    if (opts.showRequestHeaders) {
      const headers = formatHeaders(info.headers);
      if (headers) details.push(`    ${c.dim("req headers")}`, headers);
    }
    if (response !== undefined && opts.showResponseHeaders) {
      const headers = formatHeaders(response.headers);
      if (headers) details.push(`    ${c.dim("res headers")}`, headers);
    }
    if (response !== undefined && opts.showBody && response.body !== undefined) {
      details.push(`    ${c.dim("body")}`, formatBody(response.body));
    }
    return [head, details.join("\n")];
  }

  return {
    get enabled() {
      return ready("error") || ready("warn") || ready("info");
    },

    trace(message: string) {
      emit("trace", message);
    },
    debug(message: string) {
      emit("debug", message);
    },
    info(message: string) {
      emit("info", message);
    },
    warn(message: string) {
      emit("warn", message);
    },
    error(message: string) {
      emit("error", message);
    },

    request(info: ProxyLogRequest) {
      const start = Date.now();
      return {
        end(response?: ProxyLogResponse) {
          const ms = Date.now() - start;
          if (!ready("info")) return;
          const [head, details] = buildRequestLog(info, response, ms);
          stream.log(`  ${now()} ${head}${details ? `\n${details}` : ""}`);
        },
      };
    },
  };
}

export type LoggerInstance = ReturnType<typeof createLogger>;