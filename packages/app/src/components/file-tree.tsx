import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { encodeFilePath } from "@/context/file/path"
import { DialogFileTreePrompt, DialogFileTreeConfirm } from "@/components/dialog-file-tree"
// FORK: 文件树拖放移动 2026-04-27
import {
  encodeDragPaths,
  parseDataTransferPaths,
  isValidMoveTarget,
  uniqueParents,
  absoluteToRelative,
} from "@/utils/file-tree-dnd"
import { computeAvailableTarget } from "@/utils/file-conflict"
// FORK: 文件树键盘快捷键 (commit #3 of file-tree-dnd) 2026-04-27
import { useFileTreeShortcuts } from "@/hooks/use-file-tree-shortcuts"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { invoke } from "@tauri-apps/api/core"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
  Switch,
  untrack,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@opencode-ai/sdk/v2"

const MAX_DEPTH = 128

function pathToFileUrl(filepath: string): string {
  return `file://${encodeFilePath(filepath)}`
}

function trimTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, "")
}

function lastSepIndex(p: string): number {
  return Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
}

function basename(p: string): string {
  const cleaned = trimTrailingSep(p)
  const idx = lastSepIndex(cleaned)
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned
}

function dirname(p: string): string {
  const cleaned = trimTrailingSep(p)
  const idx = lastSepIndex(cleaned)
  return idx >= 0 ? cleaned.slice(0, idx) : ""
}

function joinAbs(parent: string, name: string): string {
  return `${trimTrailingSep(parent)}/${name}`
}

type Kind = "add" | "del" | "mix"

type Filter = {
  files: Set<string>
  dirs: Set<string>
}

export function shouldListRoot(input: { level: number; dir?: { loaded?: boolean; loading?: boolean } }) {
  if (input.level !== 0) return false
  if (input.dir?.loaded) return false
  if (input.dir?.loading) return false
  return true
}

export function shouldListExpanded(input: {
  level: number
  dir?: { expanded?: boolean; loaded?: boolean; loading?: boolean }
}) {
  if (input.level === 0) return false
  if (!input.dir?.expanded) return false
  if (input.dir.loaded) return false
  if (input.dir.loading) return false
  return true
}

export function dirsToExpand(input: {
  level: number
  filter?: { dirs: Set<string> }
  expanded: (dir: string) => boolean
}) {
  if (input.level !== 0) return []
  if (!input.filter) return []
  return [...input.filter.dirs].filter((dir) => !input.expanded(dir))
}

const kindLabel = (kind: Kind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

const kindTextColor = (kind: Kind) => {
  if (kind === "add") return "color: var(--icon-diff-add-base)"
  if (kind === "del") return "color: var(--icon-diff-delete-base)"
  return "color: var(--icon-diff-modified-base)"
}

const kindDotColor = (kind: Kind) => {
  if (kind === "add") return "background-color: var(--icon-diff-add-base)"
  if (kind === "del") return "background-color: var(--icon-diff-delete-base)"
  return "background-color: var(--icon-diff-modified-base)"
}

const visibleKind = (node: FileNode, kinds?: ReadonlyMap<string, Kind>, marks?: Set<string>) => {
  const kind = kinds?.get(node.path)
  if (!kind) return
  if (!marks?.has(node.path)) return
  return kind
}

// FORK-BEGIN: 拖放移动 — 全树共享的 drag state(模块级 signal,支持跨 FileTree 层级)2026-04-27
const [draggingPaths, setDraggingPaths] = createSignal<readonly string[]>([])
const [dropTargetPath, setDropTargetPath] = createSignal<string | null>(null)

/** 当前是否有项被拖动 */
function isDragging(): boolean {
  return draggingPaths().length > 0
}

/** 给定 absolute 是否被拖动(用于源行 opacity 控制) */
function isPathDragging(absolute: string): boolean {
  return draggingPaths().includes(absolute)
}

/** 重置 drag 状态(dragend / 任何位置 drop 完成 / cancel) */
function resetDragState(): void {
  setDraggingPaths([])
  setDropTargetPath(null)
}
// FORK-END

const buildDragImage = (target: HTMLElement) => {
  const icon = target.querySelector('[data-component="file-icon"]') ?? target.querySelector("svg")
  const text = target.querySelector("span")
  if (!icon || !text) return

  const image = document.createElement("div")
  image.className =
    "flex items-center gap-x-2 px-2 py-1 bg-surface-raised-base rounded-md border border-border-base text-12-regular text-text-strong"
  image.style.position = "absolute"
  image.style.top = "-1000px"
  image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
  return image
}

const withFileDragImage = (event: DragEvent) => {
  const image = buildDragImage(event.currentTarget as HTMLElement)
  if (!image) return
  document.body.appendChild(image)
  event.dataTransfer?.setDragImage(image, 0, 12)
  setTimeout(() => document.body.removeChild(image), 0)
}

const FileTreeNode = (
  p: ParentProps &
    ComponentProps<"div"> &
    ComponentProps<"button"> & {
      node: FileNode
      level: number
      active?: string
      nodeClass?: string
      draggable: boolean
      kinds?: ReadonlyMap<string, Kind>
      marks?: Set<string>
      as?: "div" | "button"
      contextOpen?: boolean
      // FORK: 多选 — 是否处于 selection 集合(用于视觉)2026-04-27
      selected?: boolean
      // FORK: 是否被剪切(在 clipboard.cut 中)— 视觉:opacity + italic 2026-04-27
      cut?: boolean
      // FORK: 多选 — 处理修饰键(Shift/Ctrl/Cmd),返回 true = 已处理(应阻止默认 click 行为)
      onSelectMaybe?: (event: MouseEvent) => boolean
      // FORK: 整组源用于拖动(可能是单个或整个 selection)— onDragStart 内部用,绕过 selection 信号读取
      computeDragSources?: () => readonly string[]
      // FORK: 右键时同步更新 selection(OS-like:右键未选中行 → replace 为该行)
      onRowContextMenu?: () => void
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "nodeClass",
    "draggable",
    "kinds",
    "marks",
    "as",
    "contextOpen",
    "selected",
    "cut",
    "onSelectMaybe",
    "computeDragSources",
    "onRowContextMenu",
    "children",
    "class",
    "classList",
    // FORK: 把 onClick 拽进 local,与 handleClick 组合后再传给 Dynamic,避免 {...rest} 覆盖 2026-04-27
    "onClick",
    // FORK: 同理 onContextMenu 也拽进 local,避免被 {...rest} 重置 undefined 2026-04-27
    "onContextMenu",
  ])
  const kind = () => visibleKind(local.node, local.kinds, local.marks)
  const active = () => !!kind() && !local.node.ignored
  const color = () => {
    const value = kind()
    if (!value) return
    return kindTextColor(value)
  }

  // FORK: 多选行 click 拦截器 — 修饰键时阻止默认行为(展开/打开),仅做选择;否则透传给原 onClick 2026-04-27
  const handleClick = (event: MouseEvent) => {
    const handled = local.onSelectMaybe?.(event) ?? false
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    // 普通 click → 让原 onClick(open file / toggle expand 经 Collapsible)正常工作
    const passed = local.onClick
    if (typeof passed === "function") {
      // Solid 的 onClick 类型可以是 EventHandlerUnion(union 包括 [handler, data])。
      // 这里仅处理函数形式;若是 [handler, data] 则忽略(实际上 file-tree 调用方都用函数形式)
      ;(passed as (event: MouseEvent) => void)(event)
    }
  }

  return (
    <Dynamic
      component={local.as ?? "div"}
      classList={{
        "w-full min-w-0 h-6 flex items-center justify-start gap-x-1.5 rounded-md px-1.5 py-0 text-left hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer": true,
        "bg-surface-base-active": local.node.path === local.active || !!local.contextOpen,
        // FORK: 拖动中的源行半透明 2026-04-27
        "opacity-50": isPathDragging(local.node.absolute),
        // FORK: 多选选中行 — 用 ring 区分于 active(filled)2026-04-27
        "ring-1 ring-interactive-base ring-inset": !!local.selected && local.node.path !== local.active,
        // FORK: 被剪切行 — 半透明 + 斜体提示"已在 clipboard 等待粘贴"(commit #3 of file-tree-dnd)2026-04-27
        "opacity-60 italic": !!local.cut,
        ...local.classList,
        [local.class ?? ""]: !!local.class,
        [local.nodeClass ?? ""]: !!local.nodeClass,
      }}
      style={`padding-left: ${Math.max(0, 8 + local.level * 12 - (local.node.type === "file" ? 24 : 4))}px`}
      draggable={local.draggable}
      onDragStart={(event: DragEvent) => {
        if (!local.draggable) return
        // FORK: 多选拖动 — 优先用 computeDragSources(单个 / 整个 selection)2026-04-27
        const sources = local.computeDragSources?.() ?? [local.node.absolute]
        // 单源 → 走原 text/plain "file:<rel>" 协议(兼容 attachments.ts 的 @-mention)
        // 多源 → 写自定义 MIME,attachments 收不到 file: 前缀就退回外部文件 drop 路径
        if (sources.length === 1) {
          event.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
          event.dataTransfer?.setData("text/uri-list", pathToFileUrl(local.node.path))
        } else {
          event.dataTransfer?.setData("application/x-deskfox-paths", JSON.stringify(sources))
        }
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove"
        withFileDragImage(event)
        setDraggingPaths(sources)
      }}
      onDragEnd={() => resetDragState()}
      onClick={handleClick}
      // FORK: 右键时同步 selection(OS-like)— 在 Kobalte ContextMenu 打开前 fire,菜单看到正确 selection 2026-04-27
      onContextMenu={() => local.onRowContextMenu?.()}
      {...rest}
    >
      {local.children}
      <span
        classList={{
          "flex-1 min-w-0 text-12-medium whitespace-nowrap truncate": true,
          "text-text-weaker": local.node.ignored,
          "text-text-weak": !local.node.ignored && !active(),
        }}
        style={active() ? color() : undefined}
      >
        {local.node.name}
      </span>
      {(() => {
        const value = kind()
        if (!value) return null
        if (local.node.type === "file") {
          return (
            <span class="shrink-0 w-4 text-center text-12-medium" style={kindTextColor(value)}>
              {kindLabel(value)}
            </span>
          )
        }
        return <div class="shrink-0 size-1.5 mr-1.5 rounded-full" style={kindDotColor(value)} />
      })()}
    </Dynamic>
  )
}

export default function FileTree(props: {
  path: string
  class?: string
  nodeClass?: string
  active?: string
  level?: number
  allowed?: readonly string[]
  modified?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void

  _filter?: Filter
  _marks?: Set<string>
  _deeps?: Map<string, number>
  _kinds?: ReadonlyMap<string, Kind>
  _chain?: readonly string[]
}) {
  const file = useFile()
  const sdk = useSDK()
  const dialog = useDialog()
  const level = props.level ?? 0
  const draggable = () => props.draggable ?? true

  // FORK-BEGIN: 多选 — selection store 取自 useFile,handleRowSelect 处理普通/Shift/Ctrl 点击 2026-04-27
  const selection = file.selection

  /** 给文件夹/文件行用的 click 处理。返回 true = 阻止默认行为(展开/打开),仅做选择 */
  const handleRowSelect = (node: FileNode, event: MouseEvent): boolean => {
    const isShift = event.shiftKey
    const isMeta = event.ctrlKey || event.metaKey
    if (isShift) {
      // 范围选 — 用当前 FileTree 可见 nodes 作扁平化 fallback(跨多层 FileTree 时只在同层范围内,可接受)
      const flat = nodes().map((n) => n.absolute)
      selection.rangeSelect(node.absolute, flat)
      return true // 阻止默认
    }
    if (isMeta) {
      selection.toggle(node.absolute)
      selection.setAnchor(node.absolute)
      return true
    }
    // 普通 click:replace selection,但**不**阻止默认(让 expand / open 正常发生)
    selection.replace(node.absolute)
    return false
  }

  /** 拖动时算源列表 — source 在 selection 中 → 拖整个 selection,否则只拖 source */
  const computeDragSources = (node: FileNode) => (): readonly string[] => {
    const sel = selection.paths()
    if (sel.includes(node.absolute)) return sel
    return [node.absolute]
  }

  /** OS-like 右键行为:右键未选中的行 → 清空 selection,把右键项设为唯一选中 */
  const handleRowContextMenu = (node: FileNode) => {
    if (!selection.isSelected(node.absolute)) {
      selection.replace(node.absolute)
    }
    // 已在 selection 中 → 保持多选(右键多选项弹出菜单作用于整组)
  }
  // FORK-END

  // FORK-BEGIN: 剪切/复制/粘贴 (commit #3 of file-tree-dnd) 2026-04-27
  const clipboard = file.clipboard

  /** 算给定上下文(右键节点 / 快捷键)的源路径列表:节点在 selection 中→整组 selection,否则只拖该节点 */
  const sourcesFor = (node: FileNode | null): string[] => {
    if (!node) return [...selection.paths()]
    const sel = selection.paths()
    if (sel.includes(node.absolute)) return [...sel]
    return [node.absolute]
  }

  const cutFor = (node: FileNode | null) => {
    const paths = sourcesFor(node)
    if (paths.length === 0) return
    clipboard.setCut(paths)
  }

  const copyFor = (node: FileNode | null) => {
    const paths = sourcesFor(node)
    if (paths.length === 0) return
    clipboard.setCopy(paths)
  }

  /** 把 clipboard 内容粘贴到 targetDirAbs。cut → rename_path 后清 clipboard;copy → copy_path 保留 clipboard */
  const pasteTo = async (targetDirAbs: string, targetDirRel: string) => {
    if (!clipboard.hasContent()) return
    const sources = clipboard.paths()
    const mode = clipboard.mode()
    if (!mode) return

    // cycle 检测复用拖放逻辑;copy 模式允许 same-dir(创建副本),cut 不允许(no-op)
    const valid = sources.filter((s) =>
      isValidMoveTarget(s, { absolute: targetDirAbs, type: "directory" }, { allowSameDir: mode === "copy" }),
    )
    if (valid.length === 0) return

    const errors: string[] = []
    const movedPairs: { from: string; to: string }[] = []
    const created: string[] = []
    for (const src of valid) {
      try {
        const target = await computeAvailableTarget(targetDirAbs, basename(src))
        if (mode === "cut") {
          await invoke("rename_path", { from: src, to: target })
          movedPairs.push({ from: src, to: target })
        } else {
          await invoke("copy_path", { from: src, to: target })
          created.push(target)
        }
      } catch (e) {
        errors.push(`${basename(src)}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // 刷新源父目录(cut 模式才需要,但都刷成本可忽略)+ 目标
    const refreshTargets = new Set<string>([targetDirRel])
    if (mode === "cut") {
      for (const parent of uniqueParents(valid)) {
        const rel = absoluteToRelative(parent, sdk.directory)
        if (rel !== null) refreshTargets.add(rel)
      }
    }
    await Promise.all([...refreshTargets].map((r) => file.tree.refresh(r)))

    // FORK: push undo 栈(commit #4 of file-tree-dnd)2026-04-28
    if (movedPairs.length > 0) file.undoStack.push({ kind: "move", pairs: movedPairs })
    if (created.length > 0) file.undoStack.push({ kind: "copy", created })

    // cut 用完即弃,copy 保留供多次粘贴
    if (mode === "cut") clipboard.clear()

    if (errors.length > 0) {
      showToast({
        variant: "error",
        title: errors.length === 1 ? "粘贴失败" : `${errors.length} 项粘贴失败`,
        description: errors[0],
      })
    }
  }

  /** Ctrl+V 智能 paste:从 selection 推断 target(文件夹→自身;文件→其父目录);否则到项目根 */
  const pasteSmart = async () => {
    const sel = selection.paths()
    let targetAbs = sdk.directory
    let targetRel = props.path
    if (sel.length >= 1) {
      // 用 selection 中第一个作锚(多选时通常用户视觉锚定的是第一个/最后一个)
      const anchorAbs = sel[0]
      // 直接通过 children 查找匹配的 node,避免 file.tree.node(path) 因 normalize 不一致取不到
      const node = findNodeByAbsolute(anchorAbs)
      if (node?.type === "directory") {
        targetAbs = node.absolute
        targetRel = node.path
      } else {
        // 文件 → 粘到其父目录
        const parentAbs = anchorAbs.replace(/[/\\][^/\\]+$/, "")
        const parentRel = absoluteToRelative(parentAbs, sdk.directory)
        if (parentRel !== null) {
          targetAbs = parentAbs
          targetRel = parentRel
        }
      }
    }
    await pasteTo(targetAbs, targetRel)
  }

  /** 通过遍历 children 找 node,避免 path normalize 不一致导致 file.tree.node(rel) 找不到 */
  const findNodeByAbsolute = (abs: string): FileNode | undefined => {
    const parentAbs = abs.replace(/[/\\][^/\\]+$/, "")
    const parentRel = absoluteToRelative(parentAbs, sdk.directory)
    if (parentRel === null) return undefined
    const children = file.tree.children(parentRel)
    return children.find((n) => n.absolute === abs)
  }

  // FORK: Ctrl+Z 撤销最近一次 move/copy(commit #4 of file-tree-dnd)2026-04-28
  const undoLast = async () => {
    const result = await file.undoStack.pop({
      reverseMove: async (pairs) => {
        const refreshAbs = new Set<string>()
        const errors: string[] = []
        // 反向 rename:to → from
        for (const { from, to } of pairs) {
          try {
            await invoke("rename_path", { from: to, to: from })
            // 收集需要刷新的源 + 目标父目录(基于 to/from 的 dirname)
            const toParent = to.replace(/[/\\][^/\\]+$/, "")
            const fromParent = from.replace(/[/\\][^/\\]+$/, "")
            refreshAbs.add(toParent)
            refreshAbs.add(fromParent)
          } catch (e) {
            errors.push(`${basename(to)}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        if (errors.length > 0) {
          showToast({
            variant: "error",
            title: "撤销失败(部分)",
            description: errors[0],
          })
        }
        return { refreshAbs: [...refreshAbs] }
      },
      reverseCopy: async (created) => {
        const refreshAbs = new Set<string>()
        const errors: string[] = []
        for (const path of created) {
          try {
            await invoke("trash_path", { path })
            const parent = path.replace(/[/\\][^/\\]+$/, "")
            refreshAbs.add(parent)
          } catch (e) {
            errors.push(`${basename(path)}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        if (errors.length > 0) {
          showToast({
            variant: "error",
            title: "撤销失败(部分)",
            description: errors[0],
          })
        }
        return { refreshAbs: [...refreshAbs] }
      },
    })
    if (!result) return // 栈空
    // 刷新涉及的目录(rel)
    const refreshRels = new Set<string>()
    for (const abs of result.refreshAbs) {
      const rel = absoluteToRelative(abs, sdk.directory)
      if (rel !== null) refreshRels.add(rel)
    }
    await Promise.all([...refreshRels].map((r) => file.tree.refresh(r)))
  }

  // FORK-BEGIN: 键盘导航 — buildFlatVisible 全局递归扫(尊重 expanded 状态)
  // [feat: file-tree-ux-polish] 2026-05-04
  /** 从 rootPath 递归构建当前可见的扁平 FileNode 序列(展开顺序 = 屏幕上下顺序)。
   * 注:不应用 nodes() memo 的 filter — 键盘导航在全树上工作,与 UI 内部 filter 解耦 */
  const buildFlatVisible = (rootPath: string): FileNode[] => {
    const out: FileNode[] = []
    const visit = (path: string) => {
      const children = file.tree.children(path)
      for (const child of children) {
        out.push(child)
        if (child.type === "directory") {
          const state = file.tree.state(child.path)
          if (state?.expanded) visit(child.path)
        }
      }
    }
    visit(rootPath)
    return out
  }

  const navigateRelative = (delta: -1 | 1) => {
    const flat = buildFlatVisible(props.path)
    if (flat.length === 0) return
    const sel = selection.paths()
    if (sel.length === 0) {
      selection.replace(flat[0].absolute)
      return
    }
    const cursorAbs = sel[sel.length - 1]
    const idx = flat.findIndex((n) => n.absolute === cursorAbs)
    if (idx < 0) {
      selection.replace(flat[0].absolute)
      return
    }
    const next = flat[idx + delta]
    if (next) selection.replace(next.absolute)
  }

  /** 找当前单选的 FileNode(从 flat 里查,因 selection 存的是 absolute) */
  const singleSelectedNode = (): FileNode | null => {
    const sel = selection.paths()
    if (sel.length !== 1) return null
    const flat = buildFlatVisible(props.path)
    return flat.find((n) => n.absolute === sel[0]) ?? null
  }

  const onEnterAction = () => {
    const node = singleSelectedNode()
    if (!node) return
    if (node.type === "directory") {
      const state = file.tree.state(node.path)
      if (state?.expanded) file.tree.collapse(node.path)
      else file.tree.expand(node.path)
    } else {
      props.onFileClick?.(node)
    }
  }

  const onRenameAction = () => {
    const node = singleSelectedNode()
    if (node) promptRename(node)
  }

  const onDeleteAction = () => {
    const sel = selection.paths()
    if (sel.length === 0) return
    const flat = buildFlatVisible(props.path)
    const first = flat.find((n) => n.absolute === sel[0])
    if (first) promptDelete(first) // promptDelete 内部 sourcesFor 处理批量
  }
  // FORK-END

  // 全局快捷键:只在 level 0(根 FileTree)注册 — 递归组件每层注册会让 keydown 触发 N 次
  if (level === 0) {
    useFileTreeShortcuts({
      onCut: () => cutFor(null),
      onCopy: () => copyFor(null),
      onPaste: pasteSmart,
      onUndo: undoLast,
      // FORK: 键盘导航 [feat: file-tree-ux-polish] 2026-05-04
      onArrowUp: () => navigateRelative(-1),
      onArrowDown: () => navigateRelative(1),
      onEnter: onEnterAction,
      onRename: onRenameAction,
      onDelete: onDeleteAction,
      hasSelection: () => selection.paths().length > 0,
    })

    // (外部 OS 文件 drop 走 dropHandlers 的 HTML5 路径 — Tauri webview 在 Windows 上 File 对象的非标准 path 字段可用,见 file-tree-dnd.ts parseExternalFilePaths)
  }
  // FORK-END

  const promptNewFileAt = (targetAbs: string, targetRel: string, onAfter?: () => void) => {
    dialog.show(() => (
      <DialogFileTreePrompt
        title="新建文件"
        label="文件名"
        defaultValue="untitled.md"
        placeholder="文件名"
        confirmLabel="创建"
        onConfirm={async (name) => {
          await invoke("create_empty_file", { path: joinAbs(targetAbs, name) })
          onAfter?.()
          await file.tree.refresh(targetRel)
        }}
      />
    ))
  }

  const promptNewFolderAt = (targetAbs: string, targetRel: string, onAfter?: () => void) => {
    dialog.show(() => (
      <DialogFileTreePrompt
        title="新建文件夹"
        label="文件夹名"
        defaultValue=""
        placeholder="新文件夹"
        confirmLabel="创建"
        onConfirm={async (name) => {
          await invoke("create_directory", { path: joinAbs(targetAbs, name) })
          onAfter?.()
          await file.tree.refresh(targetRel)
        }}
      />
    ))
  }

  const promptRename = (target: FileNode) => {
    const oldName = basename(target.absolute)
    const parentAbs = dirname(target.absolute)
    const parentRel = dirname(target.path)
    dialog.show(() => (
      <DialogFileTreePrompt
        title={target.type === "directory" ? "重命名文件夹" : "重命名文件"}
        label="新名称"
        defaultValue={oldName}
        confirmLabel="重命名"
        validate={(v) => (v === oldName ? "名称未变更" : undefined)}
        onConfirm={async (name) => {
          await invoke("rename_path", { from: target.absolute, to: joinAbs(parentAbs, name) })
          await file.tree.refresh(parentRel)
        }}
      />
    ))
  }

  // FORK-BEGIN: 复制文件路径 / 刷新单节点 helpers [feat: file-tree-ux-polish] 2026-05-04
  // 多选时拼所有 selection paths(\n 分隔);单选 / 无 selection 时用 right-clicked target.absolute
  const copyPathToClipboard = async (target: FileNode) => {
    const sel = selection.paths()
    const paths =
      sel.length > 1
        ? sel.map((p) => file.tree.node(p)?.absolute).filter((p): p is string => Boolean(p))
        : [target.absolute]
    if (paths.length === 0) return
    try {
      await navigator.clipboard.writeText(paths.join("\n"))
      showToast({
        variant: "success",
        title: paths.length === 1 ? "已复制路径" : `已复制 ${paths.length} 个路径`,
      })
    } catch (e) {
      showToast({
        variant: "error",
        title: "复制失败",
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const refreshNode = async (target: FileNode) => {
    const dir = target.type === "directory" ? target.path : dirname(target.path)
    await file.tree.refresh(dir)
  }
  // FORK-END

  // FORK-BEGIN: 拖放移动 — drop handler + spring-load 共享 timer 2026-04-27
  let springTimer: ReturnType<typeof setTimeout> | undefined
  const cancelSpringTimer = () => {
    if (springTimer) {
      clearTimeout(springTimer)
      springTimer = undefined
    }
  }
  onCleanup(cancelSpringTimer)

  /** 真正执行拖放移动:多源循环 rename + push undo + 错误聚合 + 刷新源父目录与目标 */
  const handleMoveDrop = async (targetAbs: string, targetRel: string) => {
    const sources = draggingPaths()
    if (sources.length === 0) return // 非 in-tree 拖动 — commit #4 处理外部 OS 文件 drop 见 handleExternalDrop

    const valid = sources.filter((s) => isValidMoveTarget(s, { absolute: targetAbs, type: "directory" }))
    if (valid.length === 0) return // 全部无效(拖父进子 / 拖到自身 / 已在目标),静默 no-op

    const errors: string[] = []
    const movedPairs: { from: string; to: string }[] = []
    for (const src of valid) {
      try {
        const targetPath = await computeAvailableTarget(targetAbs, basename(src))
        await invoke("rename_path", { from: src, to: targetPath })
        movedPairs.push({ from: src, to: targetPath })
      } catch (e) {
        errors.push(`${basename(src)}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // 刷新源父目录(去重)+ 目标目录
    const refreshTargets = new Set<string>([targetRel])
    for (const parent of uniqueParents(valid)) {
      const rel = absoluteToRelative(parent, sdk.directory)
      if (rel !== null) refreshTargets.add(rel)
    }
    await Promise.all([...refreshTargets].map((r) => file.tree.refresh(r)))

    // FORK: 入 undo 栈(commit #4 of file-tree-dnd)— 至少有一对成功才 push 2026-04-28
    if (movedPairs.length > 0) {
      file.undoStack.push({ kind: "move", pairs: movedPairs })
    }

    if (errors.length > 0) {
      showToast({
        variant: "error",
        title: errors.length === 1 ? "移动失败" : `${errors.length} 项移动失败`,
        description: errors[0],
      })
    }
  }

  /** OS 文件 drop(从 Windows Explorer 拖入)— 走 FileReader → base64 → Tauri 写盘
   *  Tauri webview 在 Windows 上不暴露 file.path,只能用文件内容路径
   *  注意:HTML5 dataTransfer.files 拖文件夹只给顶层 File 对象(无内容),不支持文件夹递归 — v1 跳过
   *  (commit #4 of file-tree-dnd)2026-04-28 */
  const handleExternalDrop = async (targetAbs: string, targetRel: string, files: ReadonlyArray<File>) => {
    if (files.length === 0) return
    const errors: string[] = []
    const created: string[] = []
    for (const file of files) {
      try {
        // 跳过文件夹(HTML5 拖文件夹只给空 File 对象,size=0 type="")
        if (file.size === 0 && file.type === "") {
          // 可能是空文件,可能是文件夹 — 保守起见仍尝试写空文件
        }
        const target = await computeAvailableTarget(targetAbs, file.name)
        const base64 = await readFileAsBase64(file)
        await invoke("write_binary_file_absolute_base64", { path: target, base64Content: base64 })
        created.push(target)
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await file.tree.refresh(targetRel)
    if (created.length > 0) {
      file.undoStack.push({ kind: "copy", created })
    }
    if (errors.length > 0) {
      showToast({
        variant: "error",
        title: errors.length === 1 ? "复制失败" : `${errors.length} 项复制失败`,
        description: errors[0],
      })
    }
  }

  /** 把 File 读成 base64 字符串(去掉 data URL 前缀) */
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result !== "string") return reject(new Error("FileReader returned non-string"))
        const idx = result.indexOf(",")
        resolve(idx >= 0 ? result.slice(idx + 1) : result)
      }
      reader.onerror = () => reject(reader.error ?? new Error("FileReader error"))
      reader.readAsDataURL(file)
    })
  }

  /** 给文件夹行(level > 0)和树根(level 0 空白区)绑 drop handlers */
  const dropHandlers = (targetAbs: string, targetRel: string) => ({
    onDragOver: (event: DragEvent) => {
      const inTree = isDragging()
      // FORK: 外部 OS 文件拖入(从 Windows Explorer 等)— dataTransfer.types 含 "Files"(commit #4)2026-04-28
      const externalFiles = event.dataTransfer?.types.includes("Files") ?? false
      if (!inTree && !externalFiles) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = externalFiles ? "copy" : "move"

      // 仅在 target 真切换时重置 timer + 视觉 — 否则同一行的连续 dragover 会反复重置
      if (dropTargetPath() === targetAbs) return
      cancelSpringTimer()
      setDropTargetPath(targetAbs)

      // spring-load:折叠或从未加载的目录 hover 600ms 自动展开(state undefined 也算"未展开")
      if (targetRel !== props.path) {
        const state = file.tree.state(targetRel)
        if (!state?.expanded) {
          springTimer = setTimeout(() => {
            file.tree.expand(targetRel)
            springTimer = undefined
          }, 600)
        }
      }
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      cancelSpringTimer()
      // FORK: 外部 OS 文件 — Tauri webview 不暴露 file.path,直接拿 dataTransfer.files 走 FileReader 2026-04-28
      const files = event.dataTransfer?.files
      if (files && files.length > 0) {
        void handleExternalDrop(targetAbs, targetRel, Array.from(files)).finally(() => resetDragState())
        return
      }
      void handleMoveDrop(targetAbs, targetRel).finally(() => resetDragState())
    },
  })
  // FORK-END

  const promptDelete = (target: FileNode) => {
    // FORK: 批量删除 — 右键的 target 在 selection 中就删整组,否则只删 target(同 sourcesFor 规约)2026-04-27
    const targets = sourcesFor(target)
    const single = targets.length === 1
    const onlyName = single ? basename(targets[0]) : `${targets.length} 个项目`
    dialog.show(() => (
      <DialogFileTreeConfirm
        title={single ? (target.type === "directory" ? "删除文件夹" : "删除文件") : "批量删除"}
        message={`确定要删除 ${single ? `"${onlyName}"` : onlyName} 吗?`}
        detail="将移到系统回收站,可从回收站恢复。"
        confirmLabel="删除"
        onConfirm={async () => {
          const errors: string[] = []
          for (const path of targets) {
            try {
              await invoke("trash_path", { path })
            } catch (e) {
              errors.push(`${basename(path)}: ${e instanceof Error ? e.message : String(e)}`)
            }
          }
          // 刷新所有源父目录(去重)
          const refreshTargets = new Set<string>()
          for (const parent of uniqueParents(targets)) {
            const rel = absoluteToRelative(parent, sdk.directory)
            if (rel !== null) refreshTargets.add(rel)
          }
          await Promise.all([...refreshTargets].map((r) => file.tree.refresh(r)))
          // 删完清 selection
          selection.clear()
          if (errors.length > 0) {
            showToast({
              variant: "error",
              title: errors.length === 1 ? "删除失败" : `${errors.length} 项删除失败`,
              description: errors[0],
            })
          }
        }}
      />
    ))
  }

  const revealInFolder = (target: FileNode) => {
    void invoke("reveal_in_folder", { path: target.absolute }).catch((e) => {
      showToast({ variant: "error", title: "打开失败", description: String(e) })
    })
  }

  const renderRowMenuItems = (target: FileNode) => {
    const isFolder = target.type === "directory"
    const newTargetAbs = isFolder ? target.absolute : dirname(target.absolute)
    const newTargetRel = isFolder ? target.path : dirname(target.path)
    const onAfterNew = isFolder ? () => file.tree.expand(target.path) : undefined
    // FORK-BEGIN: 节点右键菜单重整 — 4 组(重命名/复制/剪切/粘贴/删除 → 在文件夹显示/复制路径 → 新建 → 刷新),
    // 删打印,加复制路径 + 刷新 [feat: file-tree-ux-polish] 2026-05-04
    return (
      <ContextMenu.Content>
        {/* 组 1: 重命名 / 复制 / 剪切 / [粘贴] / 删除 */}
        <ContextMenu.Item onSelect={() => promptRename(target)}>
          <ContextMenu.ItemLabel>重命名</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => copyFor(target)}>
          <ContextMenu.ItemLabel>复制</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => cutFor(target)}>
          <ContextMenu.ItemLabel>剪切</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        {/* 粘贴 — 文件夹粘到自身,文件粘到其父目录;clipboard 非空才显示 */}
        <Show when={clipboard.hasContent()}>
          <ContextMenu.Item
            onSelect={() => {
              const targetAbs = isFolder ? target.absolute : dirname(target.absolute)
              const targetRel = isFolder ? target.path : dirname(target.path)
              void pasteTo(targetAbs, targetRel)
            }}
          >
            <ContextMenu.ItemLabel>{isFolder ? "粘贴到此文件夹" : "粘贴到当前目录"}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </Show>
        <ContextMenu.Item onSelect={() => promptDelete(target)}>
          <ContextMenu.ItemLabel>删除</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        {/* 组 2: 在文件夹中显示 / 复制文件路径 */}
        <ContextMenu.Item onSelect={() => revealInFolder(target)}>
          <ContextMenu.ItemLabel>在文件夹中显示</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => void copyPathToClipboard(target)}>
          <ContextMenu.ItemLabel>复制文件路径</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        {/* 组 3: 新建文件 / 新建文件夹 */}
        <ContextMenu.Item onSelect={() => promptNewFileAt(newTargetAbs, newTargetRel, onAfterNew)}>
          <ContextMenu.ItemLabel>新建文件</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => promptNewFolderAt(newTargetAbs, newTargetRel, onAfterNew)}>
          <ContextMenu.ItemLabel>新建文件夹</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        {/* 组 4: 刷新 */}
        <ContextMenu.Item onSelect={() => void refreshNode(target)}>
          <ContextMenu.ItemLabel>刷新</ContextMenu.ItemLabel>
        </ContextMenu.Item>
      </ContextMenu.Content>
    )
    // FORK-END
  }

  const renderEmptyMenuItems = () => {
    const rootAbs = sdk.directory
    const rootRel = props.path
    // FORK-BEGIN: 空白处右键菜单重整 — 2 组(新建/[粘贴] → 刷新);
    // 刷新改用 refreshAll 递归刷新所有 expanded 子目录,修"刷新但子目录没变"问题
    // [feat: file-tree-ux-polish] 2026-05-04
    return (
      <ContextMenu.Content>
        {/* 组 1: 新建文件 / 新建文件夹 / [粘贴到项目根] */}
        <ContextMenu.Item onSelect={() => promptNewFileAt(rootAbs, rootRel)}>
          <ContextMenu.ItemLabel>新建文件</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => promptNewFolderAt(rootAbs, rootRel)}>
          <ContextMenu.ItemLabel>新建文件夹</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <Show when={clipboard.hasContent()}>
          <ContextMenu.Item onSelect={() => void pasteTo(rootAbs, rootRel)}>
            <ContextMenu.ItemLabel>粘贴到项目根</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </Show>
        <ContextMenu.Separator />
        {/* 组 2: 刷新(递归) */}
        <ContextMenu.Item onSelect={() => void file.tree.refreshAll(rootRel)}>
          <ContextMenu.ItemLabel>刷新</ContextMenu.ItemLabel>
        </ContextMenu.Item>
      </ContextMenu.Content>
    )
    // FORK-END
  }

  const key = (p: string) =>
    file
      .normalize(p)
      .replace(/[\\/]+$/, "")
      .replaceAll("\\", "/")
  const chain = props._chain ? [...props._chain, key(props.path)] : [key(props.path)]

  const filter = createMemo(() => {
    if (props._filter) return props._filter

    const allowed = props.allowed
    if (!allowed) return

    const files = new Set(allowed)
    const dirs = new Set<string>()

    for (const item of allowed) {
      const parts = item.split("/")
      const parents = parts.slice(0, -1)
      for (const [idx] of parents.entries()) {
        const dir = parents.slice(0, idx + 1).join("/")
        if (dir) dirs.add(dir)
      }
    }

    return { files, dirs }
  })

  const marks = createMemo(() => {
    if (props._marks) return props._marks

    const out = new Set<string>()
    for (const item of props.modified ?? []) out.add(item)
    for (const item of props.kinds?.keys() ?? []) out.add(item)
    if (out.size === 0) return
    return out
  })

  const kinds = createMemo(() => {
    if (props._kinds) return props._kinds
    return props.kinds
  })

  const deeps = createMemo(() => {
    if (props._deeps) return props._deeps

    const out = new Map<string, number>()

    const root = props.path
    if (!(file.tree.state(root)?.expanded ?? false)) return out

    const seen = new Set<string>()
    const stack: { dir: string; lvl: number; i: number; kids: string[]; max: number }[] = []

    const push = (dir: string, lvl: number) => {
      const id = key(dir)
      if (seen.has(id)) return
      seen.add(id)

      const kids = file.tree
        .children(dir)
        .filter((node) => node.type === "directory" && (file.tree.state(node.path)?.expanded ?? false))
        .map((node) => node.path)

      stack.push({ dir, lvl, i: 0, kids, max: lvl })
    }

    push(root, level - 1)

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!

      if (top.i < top.kids.length) {
        const next = top.kids[top.i]!
        top.i++
        push(next, top.lvl + 1)
        continue
      }

      out.set(top.dir, top.max)
      stack.pop()

      const parent = stack[stack.length - 1]
      if (!parent) continue
      parent.max = Math.max(parent.max, top.max)
    }

    return out
  })

  createEffect(() => {
    const current = filter()
    const dirs = dirsToExpand({
      level,
      filter: current,
      expanded: (dir) => untrack(() => file.tree.state(dir)?.expanded) ?? false,
    })
    for (const dir of dirs) file.tree.expand(dir)
  })

  createEffect(
    on(
      () => props.path,
      (path) => {
        const dir = untrack(() => file.tree.state(path))
        if (!shouldListRoot({ level, dir })) return
        void file.tree.list(path)
      },
      { defer: false },
    ),
  )

  const nodes = createMemo(() => {
    const nodes = file.tree.children(props.path)
    const current = filter()
    if (!current) return nodes

    const parent = (path: string) => {
      const idx = path.lastIndexOf("/")
      if (idx === -1) return ""
      return path.slice(0, idx)
    }

    const leaf = (path: string) => {
      const idx = path.lastIndexOf("/")
      return idx === -1 ? path : path.slice(idx + 1)
    }

    const out = nodes.filter((node) => {
      if (node.type === "file") return current.files.has(node.path)
      return current.dirs.has(node.path)
    })

    const seen = new Set(out.map((node) => node.path))

    for (const dir of current.dirs) {
      if (parent(dir) !== props.path) continue
      if (seen.has(dir)) continue
      out.push({
        name: leaf(dir),
        path: dir,
        absolute: dir,
        type: "directory",
        ignored: false,
      })
      seen.add(dir)
    }

    for (const item of current.files) {
      if (parent(item) !== props.path) continue
      if (seen.has(item)) continue
      out.push({
        name: leaf(item),
        path: item,
        absolute: item,
        type: "file",
        ignored: false,
      })
      seen.add(item)
    }

    out.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return out
  })

  const bodyClass = `flex flex-col gap-0.5 ${level === 0 ? "min-h-full" : ""} ${props.class ?? ""}`
  const treeContent = (
    <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          const deep = () => deeps().get(node.path) ?? -1
          const kind = () => visibleKind(node, kinds(), marks())
          const active = () => !!kind() && !node.ignored
          const [contextOpen, setContextOpen] = createSignal(false)

          return (
            <Switch>
              <Match when={node.type === "directory"}>
                <ContextMenu onOpenChange={setContextOpen}>
                  <Collapsible
                    variant="ghost"
                    classList={{
                      "w-full": true,
                      // FORK: drop target 高亮 ring 2026-04-27
                      "rounded-md ring-2 ring-interactive-base ring-inset":
                        dropTargetPath() === node.absolute,
                    }}
                    data-scope="filetree"
                    // FORK: 给 Tauri onDragDropEvent 找 target 用(commit #4)2026-04-28
                    data-folder-abs={node.absolute}
                    data-folder-rel={node.path}
                    forceMount={false}
                    open={expanded()}
                    onOpenChange={(open) => (open ? file.tree.expand(node.path) : file.tree.collapse(node.path))}
                    {...dropHandlers(node.absolute, node.path)}
                  >
                    <ContextMenu.Trigger as="div" class="contents">
                      <Collapsible.Trigger>
                        <FileTreeNode
                          node={node}
                          level={level}
                          active={props.active}
                          nodeClass={props.nodeClass}
                          draggable={draggable()}
                          kinds={kinds()}
                          marks={marks()}
                          contextOpen={contextOpen()}
                          selected={selection.isSelected(node.absolute)}
                          cut={clipboard.isCut(node.absolute)}
                          onSelectMaybe={(e) => handleRowSelect(node, e)}
                          computeDragSources={computeDragSources(node)}
                          onRowContextMenu={() => handleRowContextMenu(node)}
                        >
                          <div class="size-4 flex items-center justify-center text-icon-weak">
                            <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
                          </div>
                        </FileTreeNode>
                      </Collapsible.Trigger>
                    </ContextMenu.Trigger>
                    <Collapsible.Content class="relative pt-0.5">
                      <div
                        classList={{
                          "absolute top-0 bottom-0 w-px pointer-events-none bg-border-weak-base opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none": true,
                          "group-hover/filetree:opacity-100": expanded() && deep() === level,
                          "group-hover/filetree:opacity-50": !(expanded() && deep() === level),
                        }}
                        style={`left: ${Math.max(0, 8 + level * 12 - 4) + 8}px`}
                      />
                      <Show
                        when={level < MAX_DEPTH && !chain.includes(key(node.path))}
                        fallback={<div class="px-2 py-1 text-12-regular text-text-weak">...</div>}
                      >
                        <FileTree
                          path={node.path}
                          level={level + 1}
                          allowed={props.allowed}
                          modified={props.modified}
                          kinds={props.kinds}
                          active={props.active}
                          draggable={props.draggable}
                          onFileClick={props.onFileClick}
                          _filter={filter()}
                          _marks={marks()}
                          _deeps={deeps()}
                          _kinds={kinds()}
                          _chain={chain}
                        />
                      </Show>
                    </Collapsible.Content>
                  </Collapsible>
                  <ContextMenu.Portal>{renderRowMenuItems(node)}</ContextMenu.Portal>
                </ContextMenu>
              </Match>
              <Match when={node.type === "file"}>
                <ContextMenu onOpenChange={setContextOpen}>
                  <ContextMenu.Trigger as="div" class="contents">
                    <FileTreeNode
                      node={node}
                      level={level}
                      active={props.active}
                      nodeClass={props.nodeClass}
                      draggable={draggable()}
                      kinds={kinds()}
                      marks={marks()}
                      contextOpen={contextOpen()}
                      selected={selection.isSelected(node.absolute)}
                      onSelectMaybe={(e) => handleRowSelect(node, e)}
                      computeDragSources={computeDragSources(node)}
                      as="button"
                      type="button"
                      onClick={() => props.onFileClick?.(node)}
                    >
                      <div class="w-4 shrink-0" />
                      <Switch>
                        <Match when={node.ignored}>
                          <FileIcon
                            node={node}
                            class="size-4 filetree-icon filetree-icon--mono"
                            style="color: var(--icon-weak-base)"
                            mono
                          />
                        </Match>
                        <Match when={active()}>
                          <FileIcon
                            node={node}
                            class="size-4 filetree-icon filetree-icon--mono"
                            style={kindTextColor(kind()!)}
                            mono
                          />
                        </Match>
                        <Match when={!node.ignored}>
                          <span class="filetree-iconpair size-4">
                            <FileIcon
                              node={node}
                              class="size-4 filetree-icon filetree-icon--color opacity-0 group-hover/filetree:opacity-100"
                            />
                            <FileIcon
                              node={node}
                              class="size-4 filetree-icon filetree-icon--mono group-hover/filetree:opacity-0"
                              mono
                            />
                          </span>
                        </Match>
                      </Switch>
                    </FileTreeNode>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>{renderRowMenuItems(node)}</ContextMenu.Portal>
                </ContextMenu>
              </Match>
            </Switch>
          )
        }}
      </For>
  )

  if (level !== 0) {
    return (
      <div data-component="filetree" class={bodyClass}>
        {treeContent}
      </div>
    )
  }

  // FORK-BEGIN: 树根空白区也接收 drop = 移到项目根;dragLeave 用 relatedTarget 判定真离开 2026-04-27
  const rootDropHandlers = dropHandlers(sdk.directory, props.path)
  const onRootDragLeave = (event: DragEvent) => {
    const root = event.currentTarget as HTMLElement | null
    const related = event.relatedTarget as Node | null
    // 仍在树内(进入子元素)→ 不清,避免假离开
    if (root && related && root.contains(related)) return
    cancelSpringTimer()
    setDropTargetPath(null)
  }
  return (
    <ContextMenu>
      <ContextMenu.Trigger
        as="div"
        data-component="filetree"
        // FORK: 给 Tauri onDragDropEvent 找 root target 用(commit #4)2026-04-28
        data-tree-root-abs={sdk.directory}
        data-tree-root-rel={props.path}
        classList={{
          [bodyClass]: true,
          // 拖动时整个根区域淡蓝背景提示可 drop
          "bg-surface-raised-base/30": isDragging() && dropTargetPath() === sdk.directory,
        }}
        onDragOver={rootDropHandlers.onDragOver}
        onDragLeave={onRootDragLeave}
        onDrop={rootDropHandlers.onDrop}
      >
        {treeContent}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>{renderEmptyMenuItems()}</ContextMenu.Portal>
    </ContextMenu>
  )
}
// FORK-END
