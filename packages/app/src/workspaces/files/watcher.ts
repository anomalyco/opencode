import type { FileNode } from "@/runtime/server/types"
import type { OpenCodeEvent } from "@opencode/client/promise"

type WatcherEvent = Extract<OpenCodeEvent, { type: "filesystem.changed" }>

type WatcherOps = {
  normalize: (input: string) => string
  /** The workspace root is a Windows path, whose events name files with `\`. */
  windows?: boolean
  hasFile: (path: string) => boolean
  isOpen?: (path: string) => boolean
  loadFile: (path: string) => void
  node: (path: string) => FileNode | undefined
  isDirLoaded: (path: string) => boolean
  refreshDir: (path: string) => void
}

export function invalidateFromWatcher(event: WatcherEvent, ops: WatcherOps) {
  const path = ops.normalize(event.data.file)

  if (!path) return

  if (path.startsWith(".git/") || path.startsWith(".git\\")) return

  // Paths keep the native separator, so a Windows event names `src\sub\a.ts`, where the tree, the open tabs and the
  // file cache name it `src/sub/a.ts`. A file cached under the event's own form reloads too.
  const key = ops.windows ? path.replaceAll("\\", "/") : path

  new Set([key, path]).forEach((file) => {
    if (ops.hasFile(file) || ops.isOpen?.(file)) ops.loadFile(file)
  })

  if (event.data.event === "change") {
    if (ops.node(key)?.type !== "directory") return

    if (!ops.isDirLoaded(key)) return
    ops.refreshDir(key)

    return
  }

  const parent = key.split(/[/\\]/).slice(0, -1).join("/")

  if (!ops.isDirLoaded(parent)) return

  ops.refreshDir(parent)
}
