import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pino, { type Logger, type LoggerOptions } from "pino";
import { REDACTION_CENSOR, REDACTION_PATHS } from "./redaction";

export type { Logger };

export interface RequestContext {
  correlationId: string;
  organizationId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function newCorrelationId(): string {
  return randomUUID();
}

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    name: options.service,
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    redact: { paths: REDACTION_PATHS, censor: REDACTION_CENSOR },
    // Injeta o contexto da requisição/job em toda linha, sem o chamador repassar.
    mixin() {
      const context = getContext();
      return context ? { ...context } : {};
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  if (options.pretty ?? process.env.NODE_ENV === "development") {
    return pino({ ...config, transport: { target: "pino-pretty" } });
  }

  return pino(config);
}
