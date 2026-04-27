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
      // FORK: 多选 — 处理修饰键(Shift/Ctrl/Cmd),返回 true = 已处理(应阻止默认 click 行为)
      onSelectMaybe?: (event: MouseEvent) => boolean
      // FORK: 整组源用于拖动(可能是单个或整个 selection)— onDragStart 内部用,绕过 selection 信号读取
      computeDragSources?: () => readonly string[]
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
    "onSelectMaybe",
    "computeDragSources",
    "children",
    "class",
    "classList",
    // FORK: 把 onClick 拽进 local,与 handleClick 组合后再传给 Dynamic,避免 {...rest} 覆盖 2026-04-27
    "onClick",
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
  // FORK-END

  const promptNewFileAt = (targetAbs: string, targetRel: string, onAfter?: () => void) => {
    dialog.show(() => (
      <DialogFileTreePrompt
        title="新建文件"
        label="文件名"
        defaultValue="untitled.md"
        placeholder="文件名(默认 .md)"
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

  // FORK-BEGIN: 拖放移动 — drop handler + spring-load 共享 timer 2026-04-27
  let springTimer: ReturnType<typeof setTimeout> | undefined
  const cancelSpringTimer = () => {
    if (springTimer) {
      clearTimeout(springTimer)
      springTimer = undefined
    }
  }
  onCleanup(cancelSpringTimer)

  /** 真正执行拖放移动:多源循环 rename + 错误聚合 + 刷新源父目录与目标 */
  const handleMoveDrop = async (targetAbs: string, targetRel: string) => {
    const sources = draggingPaths()
    if (sources.length === 0) return // 非 in-tree 拖动(commit #4 处理外部)

    const valid = sources.filter((s) => isValidMoveTarget(s, { absolute: targetAbs, type: "directory" }))
    if (valid.length === 0) return // 全部无效(拖父进子 / 拖到自身 / 已在目标),静默 no-op

    const errors: string[] = []
    for (const src of valid) {
      try {
        const targetPath = await computeAvailableTarget(targetAbs, basename(src))
        await invoke("rename_path", { from: src, to: targetPath })
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

    if (errors.length > 0) {
      showToast({
        variant: "error",
        title: errors.length === 1 ? "移动失败" : `${errors.length} 项移动失败`,
        description: errors[0],
      })
    }
  }

  /** 给文件夹行(level > 0)和树根(level 0 空白区)绑 drop handlers */
  const dropHandlers = (targetAbs: string, targetRel: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!isDragging()) return // 非 in-tree 拖动放行(commit #4 让 Tauri event 接管外部)
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move"

      // 仅在 target 真切换时重置 timer + 视觉 — 否则同一行的连续 dragover 会反复重置
      // 注意:HTML5 dragleave 在子元素间移动时会假触发,不能用它来重置 timer
      if (dropTargetPath() === targetAbs) return
      cancelSpringTimer()
      setDropTargetPath(targetAbs)

      // spring-load:折叠或从未加载的目录 hover 600ms 自动展开(state undefined 也算"未展开")
      if (targetRel !== props.path /* 跳过自己 FileTree 的根 */) {
        const state = file.tree.state(targetRel)
        if (!state?.expanded) {
          springTimer = setTimeout(() => {
            file.tree.expand(targetRel)
            springTimer = undefined
          }, 600)
        }
      }
    },
    // 不在 dragleave 清 timer 或视觉 — 留给 onDragOver(target 切换时)/ onDrop / onDragEnd 处理
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      cancelSpringTimer()
      void handleMoveDrop(targetAbs, targetRel).finally(() => resetDragState())
    },
  })
  // FORK-END

  const promptDelete = (target: FileNode) => {
    dialog.show(() => (
      <DialogFileTreeConfirm
        title={target.type === "directory" ? "删除文件夹" : "删除文件"}
        message={`确定要删除 "${basename(target.absolute)}" 吗?`}
        detail="将移到系统回收站,可从回收站恢复。"
        confirmLabel="删除"
        onConfirm={async () => {
          await invoke("trash_path", { path: target.absolute })
          await file.tree.refresh(dirname(target.path))
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
    return (
      <ContextMenu.Content>
        <ContextMenu.Item onSelect={() => promptRename(target)}>
          <ContextMenu.ItemLabel>重命名</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => revealInFolder(target)}>
          <ContextMenu.ItemLabel>在文件夹中显示</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item disabled={isFolder} onSelect={() => window.print()}>
          <ContextMenu.ItemLabel>打印</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => promptDelete(target)}>
          <ContextMenu.ItemLabel>删除</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => promptNewFileAt(newTargetAbs, newTargetRel, onAfterNew)}>
          <ContextMenu.ItemLabel>新建文件 (.md)</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => promptNewFolderAt(newTargetAbs, newTargetRel, onAfterNew)}>
          <ContextMenu.ItemLabel>新建文件夹</ContextMenu.ItemLabel>
        </ContextMenu.Item>
      </ContextMenu.Content>
    )
  }

  const renderEmptyMenuItems = () => {
    const rootAbs = sdk.directory
    const rootRel = props.path
    return (
      <ContextMenu.Content>
        <ContextMenu.Item onSelect={() => promptNewFileAt(rootAbs, rootRel)}>
          <ContextMenu.ItemLabel>新建文件 (.md)</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => promptNewFolderAt(rootAbs, rootRel)}>
          <ContextMenu.ItemLabel>新建文件夹</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => void file.tree.refresh(rootRel)}>
          <ContextMenu.ItemLabel>刷新</ContextMenu.ItemLabel>
        </ContextMenu.Item>
      </ContextMenu.Content>
    )
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
                          onSelectMaybe={(e) => handleRowSelect(node, e)}
                          computeDragSources={computeDragSources(node)}
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
