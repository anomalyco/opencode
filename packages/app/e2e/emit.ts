/**
 * E2E verbosity: stderr progress (`[file-e2e]`, `[e2e-tc]`) and Vitest forwarding of `console.*`
 * from browser tests stay **off** unless `OPENCODE_E2E_LOG=1` (see `vitest.e2e.config.ts` `silent`).
 */
export function e2eLogEnabled() {
  return process.env.OPENCODE_E2E_LOG === "1"
}

export function e2eEmit(msg: string) {
  if (!e2eLogEnabled()) return
  process.stderr.write(`${msg}\n`)
}

export function e2eEmitElapsed(t0: number, tag: string, msg: string) {
  e2eEmit(`[${tag}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`)
}
