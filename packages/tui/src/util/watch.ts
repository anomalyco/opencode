import { realpathSync, watch, type WatchListener } from "node:fs"
import path from "node:path"

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

/**
 * Directories to watch so edits to a file are seen even when the file is a symlink. The symlink's own
 * directory is watched for replaced links; the target's directory is watched because that is where
 * writes to the target land.
 */
export function fileWatchDirs(file: string) {
  const dirs = [path.dirname(file)]
  try {
    const real = path.dirname(realpathSync(file))
    if (!dirs.includes(real)) dirs.push(real)
  } catch {
    // The file may not exist yet; the symlink's own directory is still watched.
  }
  return dirs
}
