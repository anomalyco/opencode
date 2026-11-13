import { once } from "node:events"
import { fstatSync } from "node:fs"
import { text } from "node:stream/consumers"

export function readStdin() {
  return text(process.stdin)
}

/**
 * Reads a shell pipe or redirected file in full, however slow its producer. Any other stdin (the socket
 * that spawn's default stdio gives a child) is read only if it has data or ends within `grace`
 * milliseconds; otherwise it is closed unread.
 */
export async function readStdinIfReady(grace: number) {
  const stat = fstatSync(0)
  if (stat.isFIFO() || stat.isFile()) return readStdin()
  const ready = await once(process.stdin, "readable", { signal: AbortSignal.timeout(grace) }).then(
    () => true,
    () => false,
  )
  if (ready) return readStdin()
  process.stdin.destroy()
  return undefined
}
