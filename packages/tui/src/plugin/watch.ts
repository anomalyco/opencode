import path from "path"
import { existsSync, watch } from "fs"
import { lstat, realpath, stat } from "fs/promises"

// Watch plugin sources for changes. Files are watched through their parent
// directory (editors that save by rename replace the inode, which silently
// kills a direct file watch) and filtered by basename so bursts in busy
// directories stay quiet. Symlinked files are additionally watched at their
// resolved target, since edits there emit nothing at the link's location.
// Directory targets are watched at their root only; the plugin source loader
// adds each resolved local dependency separately, including nested helpers.
// Watches are never torn down individually (a stale watch costs one fs handle and a
// spurious onChange); all die with dispose(). Missing retryable targets are
// polled until they can be armed without relying on a racy chain of ancestor
// watches.
export function createSourceWatcher(onChange: () => void) {
  const watchers = new Map<string, ReturnType<typeof watch>>()
  const watched = new Map<string, Set<string> | null>()
  const missing = new Set<string>()
  const arming = new Map<string, Promise<void>>()
  let disposed = false
  const notify = () => {
    if (!disposed) onChange()
  }
  const forget = (dir: string) => {
    watchers.get(dir)?.close()
    watchers.delete(dir)
    watched.delete(dir)
  }
  const arm = (target: string, retry: boolean) => {
    const active = arming.get(target)
    if (active) return active
    const result = stat(target)
      .then((info) => {
        if (disposed) return
        const appeared = missing.delete(target)
        const dir = info.isDirectory() ? target : path.dirname(target)
        // Directories accept every filename (null); files accept their basename.
        const name = info.isDirectory() ? null : path.basename(target)
        const existing = watched.get(dir)
        if (existing !== undefined) {
          if (name === null) watched.set(dir, null)
          else existing?.add(name)
          if (appeared) notify()
          return
        }
        const watcher = watch(dir, (_event, filename) => {
          // A replaced directory keeps this watcher on the dead inode (Linux
          // emits rename, not error); forget it so a later add() re-arms on
          // the recreated path, and still schedule so reconcile runs now.
          if (!existsSync(dir)) {
            forget(dir)
            notify()
            return
          }
          // A null filename (platform-dependent) always schedules.
          const accept = watched.get(dir)
          if (filename && accept && !accept.has(filename.toString())) return
          notify()
        })
        watched.set(dir, name === null ? null : new Set([name]))
        // Reconcile after watcher errors so every source is re-added and any
        // temporarily unavailable target moves into the polling set.
        watcher.on("error", () => {
          forget(dir)
          notify()
        })
        watchers.set(dir, watcher)
        if (appeared) notify()
      })
      .catch((error: unknown) => {
        if (!disposed && retry && isMissing(error)) missing.add(target)
      })
      .finally(() => arming.delete(target))
    arming.set(target, result)
    return result
  }
  const add = async (target: string, retry: boolean) => {
    await arm(target, retry)
    // A symlinked source receives edits at its resolved target.
    await lstat(target)
      .then((info) => {
        if (!info.isSymbolicLink()) return
        return realpath(target).then((target) => arm(target, retry))
      })
      .catch(() => undefined)
  }
  const dispose = () => {
    disposed = true
    clearInterval(poll)
    for (const watcher of watchers.values()) watcher.close()
    watchers.clear()
    watched.clear()
    missing.clear()
  }
  const poll = setInterval(() => missing.forEach((target) => arm(target, true)), 500)
  poll.unref()
  return {
    add: (target: string) => add(target, false),
    wait: (target: string) => add(target, true),
    dispose,
  }
}

function isMissing(error: unknown) {
  if (!error || typeof error !== "object") return false
  const code = Reflect.get(error, "code")
  return code === "ENOENT" || code === "ENOTDIR"
}
