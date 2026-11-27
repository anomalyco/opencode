import { readlinkSync, realpathSync, watch, type WatchListener } from "node:fs"
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
    // The target is missing (or the file does not exist). For a dangling symlink keep watching the directory the
    // link points into, so the target coming back is still seen.
    try {
      const dir = path.dirname(path.resolve(path.dirname(file), readlinkSync(file)))
      if (!dirs.includes(dir)) dirs.push(dir)
    } catch {
      // Not a symlink: only the file's own directory is watched.
    }
  }
  return dirs
}

/**
 * Watch a file for changes, following it if it is a symlink. The symlink's directory is always watched.
 * Whenever either directory reports an event the target is resolved again, so a link created or repointed
 * while running moves the second watcher to the new target's directory.
 */
export function watchFile(file: string, listener: () => void) {
  const watchers = new Map<string, ReturnType<typeof safeWatch>>()
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const settle = {
    refresh: () => {
      clearTimeout(timer)
      timer = setTimeout(() => sync(), 100)
      timer.unref?.()
    },
  }
  const sync = () => {
    if (closed) return
    const wanted = new Set(fileWatchDirs(file))
    for (const [dir, watcher] of watchers) {
      if (wanted.has(dir)) continue
      watcher?.close()
      watchers.delete(dir)
    }
    for (const dir of wanted) {
      if (watchers.has(dir)) continue
      watchers.set(
        dir,
        safeWatch(dir, () => {
          sync()
          listener()
          // Replacing a link is a remove plus a create and can be reported once, before the new link exists.
          // Resolve again shortly after so the new target is still picked up.
          settle.refresh()
        }),
      )
    }
  }
  sync()
  return {
    dirs: () => [...watchers.keys()],
    close: () => {
      closed = true
      clearTimeout(timer)
      watchers.forEach((watcher) => watcher?.close())
      watchers.clear()
    },
  }
}
