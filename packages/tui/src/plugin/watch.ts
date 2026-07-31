import path from "path"
import { watch } from "fs"
import { stat } from "fs/promises"

// Watch plugin sources for changes. Files are watched through their parent
// directory (editors that save by rename replace the inode, which silently
// kills a direct file watch) and filtered by basename so bursts in busy
// directories stay quiet. Directory targets are watched at their root only:
// edits to nested helper files do not change the entrypoint mtime and are
// not detected. Watches are never torn down individually (a stale watch
// costs one fs handle and a spurious onChange); all die with dispose().
// Failed watches are forgotten so a later add() can re-arm once the path
// exists.
export function createSourceWatcher(onChange: () => void) {
  const watchers = new Set<ReturnType<typeof watch>>()
  const watched = new Map<string, Set<string> | null>()
  let disposed = false
  const add = (target: string) => {
    stat(target)
      .then((info) => {
        if (disposed) return
        const dir = info.isDirectory() ? target : path.dirname(target)
        // Directories accept every filename (null); files accept their basename.
        const name = info.isDirectory() ? null : path.basename(target)
        const existing = watched.get(dir)
        if (existing !== undefined) {
          if (name === null) watched.set(dir, null)
          else existing?.add(name)
          return
        }
        watched.set(dir, name === null ? null : new Set([name]))
        const watcher = watch(dir, (_event, filename) => {
          // A null filename (platform-dependent) always schedules.
          const accept = watched.get(dir)
          if (filename && accept && !accept.has(filename.toString())) return
          onChange()
        })
        // A watched directory can disappear out from under us; without a
        // listener the error event would crash the process. Forget the path
        // so a later add can re-arm once it exists again.
        watcher.on("error", () => {
          watcher.close()
          watchers.delete(watcher)
          watched.delete(dir)
        })
        watchers.add(watcher)
      })
      .catch(() => undefined)
  }
  const dispose = () => {
    disposed = true
    for (const watcher of watchers) watcher.close()
  }
  return { add, dispose }
}
