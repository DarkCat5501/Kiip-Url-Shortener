export type Logger = {
  warn: (message: string, ...rest: unknown[]) => void;
  error: (message: string, ...rest: unknown[]) => void;
};

export function createLogger(context: string): Logger {
  return {
    warn: (message, ...rest) => console.warn(`[${context}] ${message}`, ...rest),
    error: (message, ...rest) => console.error(`[${context}] ${message}`, ...rest),
  };
}
