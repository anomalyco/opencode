import path from "path"
import { existsSync, watch } from "fs"
import { lstat, realpath, stat } from "fs/promises"

// Watch plugin sources for changes. Files are watched through their parent
// directory (editors that save by rename replace the inode, which silently
// kills a direct file watch) and filtered by basename so bursts in busy
// directories stay quiet. Symlinked files are additionally watched at their
// resolved target, since edits there emit nothing at the link's location.
// Directory targets are watched at their root only: edits to nested helper
// files do not change the entrypoint mtime and are not detected. Watches are
// never torn down individually (a stale watch costs one fs handle and a
// spurious onChange); all die with dispose(). Failed or vanished watches are
// forgotten so a later add() can re-arm once the path exists.
export function createSourceWatcher(onChange: () => void) {
  const watchers = new Map<string, ReturnType<typeof watch>>()
  const watched = new Map<string, Set<string> | null>()
  let disposed = false
  const forget = (dir: string) => {
    watchers.get(dir)?.close()
    watchers.delete(dir)
    watched.delete(dir)
  }
  const arm = (target: string) => {
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
          // A replaced directory keeps this watcher on the dead inode (Linux
          // emits rename, not error); forget it so a later add() re-arms on
          // the recreated path, and still schedule so reconcile runs now.
          if (!existsSync(dir)) {
            forget(dir)
            onChange()
            return
          }
          // A null filename (platform-dependent) always schedules.
          const accept = watched.get(dir)
          if (filename && accept && !accept.has(filename.toString())) return
          onChange()
        })
        // A watched directory can disappear out from under us; without a
        // listener the error event would crash the process. Forget the path
        // so a later add can re-arm once it exists again.
        watcher.on("error", () => forget(dir))
        watchers.set(dir, watcher)
      })
      .catch(() => undefined)
  }
  const add = (target: string) => {
    arm(target)
    // A symlinked source receives edits at its resolved target.
    lstat(target)
      .then((info) => {
        if (!info.isSymbolicLink()) return
        return realpath(target).then(arm)
      })
      .catch(() => undefined)
  }
  const dispose = () => {
    disposed = true
    for (const watcher of watchers.values()) watcher.close()
  }
  return { add, dispose }
}
