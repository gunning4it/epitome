/**
 * Structured Logger
 *
 * JSON-formatted logging with levels: debug, info, warn, error
 *
 * - Debug logs only emit when LOG_LEVEL=debug or NODE_ENV !== 'production'
 * - All output is JSON for machine parsing in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && LEVEL_PRIORITY[envLevel] !== undefined) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()];
}

function formatEntry(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    level,
    msg: message,
    ts: new Date().toISOString(),
  };
  if (context) {
    Object.assign(entry, context);
  }
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    if (!shouldLog('debug')) return;
    console.debug(formatEntry('debug', message, context));
  },

  info(message: string, context?: Record<string, unknown>) {
    if (!shouldLog('info')) return;
    console.info(formatEntry('info', message, context));
  },

  warn(message: string, context?: Record<string, unknown>) {
    if (!shouldLog('warn')) return;
    console.warn(formatEntry('warn', message, context));
  },

  error(message: string, context?: Record<string, unknown>) {
    if (!shouldLog('error')) return;
    console.error(formatEntry('error', message, context));
  },
};
