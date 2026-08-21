import type { FileNode } from "@/runtime/server/types"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"

type WatcherEvent = Extract<OpenCodeEvent, { type: "filesystem.changed" }>

type WatcherOps = {
  normalize: (input: string) => string
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
  if (path.startsWith(".git/")) return

  if (ops.hasFile(path) || ops.isOpen?.(path)) {
    ops.loadFile(path)
  }

  if (event.data.event === "change") {
    if (ops.node(path)?.type !== "directory") return
    if (!ops.isDirLoaded(path)) return
    ops.refreshDir(path)
    return
  }
  const parent = path.split("/").slice(0, -1).join("/")
  if (!ops.isDirLoaded(parent)) return

  ops.refreshDir(parent)
}
