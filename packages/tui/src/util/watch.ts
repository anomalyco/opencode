import { watch, type WatchListener } from "node:fs"

/**
 * Watch a path without letting a failed watch take down the TUI. fs.watch throws
 * synchronously when the host cannot allocate one (e.g. ENOSPC/EMFILE when the
 * inotify budget is exhausted) and emits "error" later if the watch breaks; an
 * unhandled "error" event crashes the process. Losing live-reload is recoverable,
 * so both paths close the watch and log. Honors the server's disable switch.
 */
export function safeWatch(target: string, listener: WatchListener<string>) {
  const disabled = process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER
  if (disabled === "1" || disabled?.toLowerCase() === "true") return
  try {
    const watcher = watch(target, listener)
    watcher.on("error", (error) => {
      watcher.close()
      console.error("Watch failed, live-reload disabled", { target, error })
    })
    return watcher
  } catch (error) {
    console.error("Failed to watch path, live-reload disabled", { target, error })
    return
  }
}
