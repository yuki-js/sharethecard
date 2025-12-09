/**
 * Structured Logging Utility
 * Provides consistent logging across cardhost, controller, and router
 * 
 * Based on research insights: Clear logging is critical for debugging
 * complex distributed systems and protocol issues.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  component: string;
  operation?: string;
  [key: string]: unknown;
}

/**
 * Structured logger with context support
 */
export class Logger {
  constructor(
    private component: string,
    private minLevel: LogLevel = "info",
  ) {}

  /**
   * Check if level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const minIndex = levels.indexOf(this.minLevel);
    const currentIndex = levels.indexOf(level);
    return currentIndex >= minIndex;
  }

  /**
   * Format log message with context
   */
  private format(level: LogLevel, message: string, context?: Partial<LogContext>): string {
    const timestamp = new Date().toISOString();
    const ctx = { component: this.component, ...context };
    const contextStr = Object.entries(ctx)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    return `[${timestamp}] ${level.toUpperCase()} ${contextStr} - ${message}`;
  }

  debug(message: string, context?: Partial<LogContext>): void {
    if (this.shouldLog("debug")) {
      console.debug(this.format("debug", message, context));
    }
  }

  info(message: string, context?: Partial<LogContext>): void {
    if (this.shouldLog("info")) {
      console.info(this.format("info", message, context));
    }
  }

  warn(message: string, context?: Partial<LogContext>): void {
    if (this.shouldLog("warn")) {
      console.warn(this.format("warn", message, context));
    }
  }

  error(message: string, error?: Error, context?: Partial<LogContext>): void {
    if (this.shouldLog("error")) {
      const errorContext = error
        ? { ...context, error: error.message, stack: error.stack }
        : context;
      console.error(this.format("error", message, errorContext));
    }
  }

  /**
   * Create child logger with additional context
   */
  child(additionalContext: Partial<LogContext>): Logger {
    const childLogger = new Logger(this.component, this.minLevel);
    const originalFormat = childLogger.format.bind(childLogger);
    childLogger.format = (level, message, context) => {
      return originalFormat(level, message, { ...additionalContext, ...context });
    };
    return childLogger;
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
}

/**
 * Create logger instance
 */
export function createLogger(component: string, level: LogLevel = "info"): Logger {
  return new Logger(component, level);
}