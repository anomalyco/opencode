// The node runtime branch of "#stderr-capture": node exposes no fd-level dup
// here, so stderr stays attached to the terminal under the node runtime.
export type StderrCapture = {
  readonly path: string
  restore(): void
}

export function captureStderr(_dir: string): StderrCapture | undefined {
  return undefined
}
