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

declare function require(id: string): unknown

declare module 'fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: string): string
  export function writeFileSync(path: string, data: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
}

declare module 'path' {
  export function join(...parts: string[]): string
  export function dirname(p: string): string
  export function resolve(...parts: string[]): string
}
