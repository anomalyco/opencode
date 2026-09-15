import { closeSync, constants, fchmodSync, fstatSync, openSync, writeSync } from "fs"

type Write = NodeJS.WriteStream["write"]

const MAX_LOG_BYTES = 5 * 1024 * 1024

// opentui does not intercept raw stdout/stderr writes, which paint over its alternate screen.
// Frame output bypasses these wrappers, so redirecting them is safe.
export function installStdioGuard(sink: (text: string) => void) {
  const restores = [process.stdout, process.stderr].map((stream) => {
    const original = stream.write
    stream.write = ((chunk: string | Uint8Array, encoding?: unknown, callback?: unknown) => {
      // Node allows the callback in either the second or third position.
      const done = typeof encoding === "function" ? encoding : callback
      // A failing sink must never surface inside unrelated code that merely logged.
      try {
        sink(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
      } catch {}
      if (typeof done === "function") process.nextTick(done)
      return true
    }) as Write
    return () => {
      stream.write = original
    }
  })
  return () => restores.forEach((restore) => restore())
}

export function installStdioFileGuard(file: string, options: { maxBytes?: number; truncate?: boolean } = {}) {
  const descriptor = (() => {
    try {
      return openSync(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (options.truncate ? constants.O_TRUNC : 0),
        0o600,
      )
    } catch {
      return undefined
    }
  })()
  if (descriptor === undefined) return installStdioGuard(() => {})
  fchmodSync(descriptor, 0o600)
  const maximum = options.maxBytes ?? MAX_LOG_BYTES
  let bytes = options.truncate ? 0 : fstatSync(descriptor).size
  let closed = false
  const restore = installStdioGuard((text) => {
    const remaining = maximum - bytes
    if (remaining <= 0) return
    const content = Buffer.from(text)
    const written = writeSync(descriptor, content.subarray(0, remaining))
    bytes += written
  })
  return () => {
    if (closed) return
    closed = true
    restore()
    try {
      closeSync(descriptor)
    } catch {}
  }
}
