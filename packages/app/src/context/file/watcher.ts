import type { FileNode } from "@opencode-ai/sdk/v2"

type WatcherEvent = {
  type: string
  properties: unknown
}

type WatcherOps = {
  normalize: (input: string) => string
  hasFile: (path: string) => boolean
  isOpen?: (path: string) => boolean
  loadFile: (path: string) => void
  node: (path: string) => FileNode | undefined
  isDirLoaded: (path: string) => boolean
  refreshDir: (path: string) => void
}

// ── Debounced watcher ────────────────────────────────────────────────
// Collect invalidation targets over a short window and flush them in a
// single batch.  This avoids firing N parallel HTTP requests when an
// agent writes N files in quick succession.

const DEBOUNCE_MS = 150

let pendingFiles = new Set<string>()
let pendingDirs = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let lastOps: WatcherOps | undefined

function flush() {
  timer = undefined
  const ops = lastOps
  if (!ops) return

  const files = pendingFiles
  const dirs = pendingDirs
  pendingFiles = new Set()
  pendingDirs = new Set()

  for (const file of files) {
    ops.loadFile(file)
  }
  for (const dir of dirs) {
    ops.refreshDir(dir)
  }
}

function schedule(ops: WatcherOps) {
  lastOps = ops
  if (timer !== undefined) return
  timer = setTimeout(flush, DEBOUNCE_MS)
}

export function invalidateFromWatcher(event: WatcherEvent, ops: WatcherOps) {
  if (event.type !== "file.watcher.updated") return
  const props =
    typeof event.properties === "object" && event.properties ? (event.properties as Record<string, unknown>) : undefined
  const rawPath = typeof props?.file === "string" ? props.file : undefined
  const kind = typeof props?.event === "string" ? props.event : undefined
  if (!rawPath) return
  if (!kind) return

  const path = ops.normalize(rawPath)
  if (!path) return
  if (path.startsWith(".git/")) return

  if (ops.hasFile(path) || ops.isOpen?.(path)) {
    pendingFiles.add(path)
    schedule(ops)
  }

  if (kind === "change") {
    const dir = (() => {
      if (path === "") return ""
      const node = ops.node(path)
      if (node?.type !== "directory") return
      return path
    })()
    if (dir === undefined) return
    if (!ops.isDirLoaded(dir)) return
    pendingDirs.add(dir)
    schedule(ops)
    return
  }
  if (kind !== "add" && kind !== "unlink") return

  const parent = path.split("/").slice(0, -1).join("/")
  if (!ops.isDirLoaded(parent)) return
  pendingDirs.add(parent)
  schedule(ops)
}
