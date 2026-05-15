;(globalThis as { __galStarted?: bigint }).__galStarted = process.hrtime.bigint()
await import('./index.ts')
