/** Playwright workers / Bun often buffer `console.log`; stderr is line-buffered and shows up immediately in CI and local TTYs. */
export function e2eEmit(msg: string) {
  process.stderr.write(`${msg}\n`)
}

export function e2eEmitElapsed(t0: number, tag: string, msg: string) {
  e2eEmit(`[${tag}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`)
}
