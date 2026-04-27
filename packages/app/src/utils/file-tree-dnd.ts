// [fork-only] 文件树拖放 helpers — 与 file-tree.tsx 自定义 onDragStart/onDrop 配合
// 仓内 dataTransfer 协议:`text/plain` = "file:<absolutePath>"(可多行,每行一项,支持多选)

import type { FileNode } from "@opencode-ai/sdk/v2"

const DRAG_PREFIX = "file:"

/** 编码源路径列表到 dataTransfer(多选时多行) */
export function encodeDragPaths(absolutePaths: string[]): string {
  return absolutePaths.map((p) => DRAG_PREFIX + p).join("\n")
}

/** 解析 dataTransfer 拿出仓内拖出的源路径列表;非仓内拖动返回 [] */
export function parseDataTransferPaths(dt: DataTransfer | null): string[] {
  if (!dt) return []
  const text = dt.getData("text/plain")
  if (!text) return []
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(DRAG_PREFIX)) continue
    out.push(trimmed.slice(DRAG_PREFIX.length))
  }
  return out
}

/** 解析 OS 文件拖入(从 Windows Explorer 等),从 dataTransfer.files 读 */
export function parseExternalFilePaths(dt: DataTransfer | null): string[] {
  if (!dt?.files) return []
  const out: string[] = []
  for (let i = 0; i < dt.files.length; i++) {
    const file = dt.files[i]
    // @ts-expect-error: Tauri webview 上 File 有非标准 path 属性
    const p = file?.path
    if (typeof p === "string" && p.length > 0) out.push(p)
  }
  return out
}

const SEPS = ["/", "\\"]

function trimTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, "")
}

function lastSepIndex(p: string): number {
  return Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
}

function dirname(p: string): string {
  const cleaned = trimTrailingSep(p)
  const idx = lastSepIndex(cleaned)
  return idx >= 0 ? cleaned.slice(0, idx) : ""
}

/**
 * 验证 source 能否移动到 targetDir。返回 false 时静默拒绝(类资源管理器)。
 *
 * 拒绝条件:
 * 1. source === targetDir(拖到自身)
 * 2. targetDir 在 source 的子树里(拖父进子,会形成 cycle)
 * 3. source 已直接位于 targetDir 下(no-op,避免无意义 rename 触发刷新)
 */
export function isValidMoveTarget(sourceAbs: string, targetDir: { absolute: string; type?: string }): boolean {
  if (targetDir.type && targetDir.type !== "directory") return false
  const src = trimTrailingSep(sourceAbs)
  const dst = trimTrailingSep(targetDir.absolute)
  if (src === dst) return false
  // 拖父进子:任一分隔符开头都算
  for (const sep of SEPS) {
    if (dst === src || dst.startsWith(src + sep)) return false
  }
  // 已在目标目录
  if (dirname(src) === dst) return false
  return true
}

/** 算多个源的去重父目录列表,用于操作完成后批量刷新 */
export function uniqueParents(absolutePaths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of absolutePaths) {
    const parent = dirname(p)
    if (seen.has(parent)) continue
    seen.add(parent)
    out.push(parent)
  }
  return out
}

/** 把绝对路径转回项目内的相对路径(基于 directory 根)。失败返回 null */
export function absoluteToRelative(absolute: string, directory: string): string | null {
  const dir = trimTrailingSep(directory)
  const abs = trimTrailingSep(absolute)
  if (abs === dir) return ""
  for (const sep of SEPS) {
    if (abs.startsWith(dir + sep)) return abs.slice(dir.length + 1).replaceAll("\\", "/")
  }
  return null
}

export type DropContext = {
  /** 树根的绝对路径(SDK directory)用于把 absolute 转回 relative 做刷新 */
  rootAbsolute: string
  /** target 文件夹绝对路径;null 表示树根空白区 */
  targetAbsolute: string
}

/** 多选拖动时,合并源拖动节点和当前 selection 决定真正要拖的列表 */
export function resolveDragSources(node: FileNode, selectionPaths: ReadonlyArray<string>): string[] {
  // 如果拖的节点已在 selection 里 → 拖整个 selection
  if (selectionPaths.includes(node.absolute)) return [...selectionPaths]
  // 否则 → 只拖这一个
  return [node.absolute]
}
