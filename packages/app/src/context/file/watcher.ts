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
  // FORK: AI/外部写文件触发刷新前的编辑态守卫(查看器-自动刷新 2026-04-28)
  isDirty?: (path: string) => boolean
  notifyDirtyConflict?: (path: string) => void
  node: (path: string) => FileNode | undefined
  isDirLoaded: (path: string) => boolean
  refreshDir: (path: string) => void
}

export function invalidateFromWatcher(event: WatcherEvent, ops: WatcherOps) {
  const props =
    typeof event.properties === "object" && event.properties ? (event.properties as Record<string, unknown>) : undefined
  const rawPath = typeof props?.file === "string" ? props.file : undefined
  if (!rawPath) return

  // path.normalize 在 Windows 上会保留原生反斜杠分隔(upstream commit 082f0cc12 故意),
  // 但 store key 走 tab URL encode/decode 后是正斜杠 — 直接比对必然不匹配。
  // 这里强制转正斜杠以对齐 store key 的实际形态(查看器-自动刷新 fix 2026-04-28)。
  const toUnix = (p: string) => p.replace(/\\/g, "/")

  // 主路径:Edit/Write/ApplyPatch tool 直发的 file.edited
  // FORK: AI 创建新文件场景刷父目录 — 修"AI 生成后文件树不刷新,需 F5 才出现"bug 2026-05-15
  // file.edited 不带 kind 字段,无法区分 create/modify。但路径既不在 hasFile 又未 open
  // ⇒ 大概率是新建文件 → 若父目录已加载(无论展开/折叠),refresh 父目录把新文件加进 children
  // 让用户下次展开时浮现。已存在文件的 edit 走 loadFile 路径(原逻辑保留)。
  if (event.type === "file.edited") {
    const path = toUnix(ops.normalize(rawPath))
    console.debug("[fs.watcher] file.edited", { rawPath, normalized: path })
    if (!path) return
    if (path.startsWith(".git/")) return
    if (!ops.hasFile(path) && !ops.isOpen?.(path)) {
      const parent = path.split("/").slice(0, -1).join("/")
      if (ops.isDirLoaded(parent)) ops.refreshDir(parent)
      return
    }
    if (ops.isDirty?.(path)) {
      ops.notifyDirtyConflict?.(path)
      return
    }
    ops.loadFile(path)
    return
  }

  // 兜底:OS watcher 触发的 file.watcher.updated(覆盖外部编辑场景)
  if (event.type !== "file.watcher.updated") return
  const kind = typeof props?.event === "string" ? props.event : undefined
  if (!kind) return

  const path = toUnix(ops.normalize(rawPath))
  console.debug("[fs.watcher]", { rawPath, kind, normalized: path })
  if (!path) return
  if (path.startsWith(".git/")) return

  if (ops.hasFile(path) || ops.isOpen?.(path)) {
    if (ops.isDirty?.(path)) {
      ops.notifyDirtyConflict?.(path)
    } else {
      ops.loadFile(path)
    }
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
    ops.refreshDir(dir)
    return
  }
  if (kind !== "add" && kind !== "unlink") return

  const parent = path.split("/").slice(0, -1).join("/")
  console.debug("[fs.watcher] refresh", { parent, isLoaded: ops.isDirLoaded(parent) })
  if (!ops.isDirLoaded(parent)) return

  ops.refreshDir(parent)
}
