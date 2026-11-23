import { once } from "node:events"
import { fstatSync } from "node:fs"
import { text } from "node:stream/consumers"

export async function readStdin(signal?: AbortSignal) {
  if (!signal) return text(process.stdin)
  if (signal.aborted) {
    process.stdin.destroy()
    return ""
  }
  const abort = () => {
    process.stdin.destroy()
  }
  signal.addEventListener("abort", abort, { once: true })
  return text(process.stdin)
    .catch((error) => {
      if (signal.aborted) return ""
      throw error
    })
    .finally(() => {
      signal.removeEventListener("abort", abort)
    })
}

/**
 * Reads a shell pipe or redirected file in full, however slow its producer. Any other stdin (the socket
 * that spawn's default stdio gives a child) is read only if it has data or ends within `grace`
 * milliseconds; otherwise it is closed unread.
 */
export async function readStdinIfReady(grace: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    process.stdin.destroy()
    return undefined
  }
  const stat = fstatSync(0)
  const ready =
    stat.isFIFO() || stat.isFile()
      ? true
      : await once(process.stdin, "readable", {
          signal: signal ? AbortSignal.any([AbortSignal.timeout(grace), signal]) : AbortSignal.timeout(grace),
        }).then(
          () => true,
          () => false,
        )
  if (!ready || signal?.aborted) {
    process.stdin.destroy()
    return undefined
  }
  const value = await readStdin(signal)
  return signal?.aborted ? undefined : value
}
