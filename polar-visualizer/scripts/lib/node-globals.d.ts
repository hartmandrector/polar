/** Minimal Node.js globals for scripts (no @types/node needed) */
declare const console: {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
}
declare const process: {
  argv: string[]
  exit(code?: number): never
}
declare const performance: { now(): number }
