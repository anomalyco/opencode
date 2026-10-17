import { watch, type FSWatcher } from "node:fs"

/**
 * Watch a path without letting a failed watch take down the TUI. fs.watch throws
 * synchronously when the host cannot allocate one (e.g. EMFILE/ENOSPC when the
 * inotify budget is exhausted); losing live-reload is recoverable, crashing the
 * whole session is not. Honors the same disable switch as the server so users in
 * constrained containers can opt out of every TUI watcher.
 */
export function safeWatch(
  target: string,
  listener: (event: string, filename: string | null) => void,
): FSWatcher | undefined {
  const disabled = process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER
  if (disabled === "1" || disabled?.toLowerCase() === "true") return undefined
  try {
    return watch(target, listener)
  } catch (error) {
    console.error("Failed to watch path, live-reload disabled", { target, error })
    return undefined
  }
}
