import { useFile } from "@/context/file"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import "@opencode-ai/ui/v2/file-tree-v2.css"
import {
  createEffect,
  createMemo,
  For,
  Match,
  on,
  Show,
  splitProps,
  Switch,
  untrack,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import {
  dirsToExpand,
  pathToFileUrl,
  shouldListRoot,
  visibleKind,
  withFileDragImage,
  type Filter,
  type Kind,
} from "@/components/file-tree"

export type { Kind } from "@/components/file-tree"

const MAX_DEPTH = 128

function visibleNodesForPath(path: string, children: (dir: string) => FileNode[], current: Filter | undefined) {
  const nodes = children(path)
  if (!current) return nodes

  const parent = (item: string) => {
    const idx = item.lastIndexOf("/")
    if (idx === -1) return ""
    return item.slice(0, idx)
  }

  const leaf = (item: string) => {
    const idx = item.lastIndexOf("/")
    return idx === -1 ? item : item.slice(idx + 1)
  }

  const out = nodes.filter((node) => {
    if (node.type === "file") return current.files.has(node.path)
    return current.dirs.has(node.path)
  })

  const seen = new Set(out.map((node) => node.path))

  for (const dir of current.dirs) {
    if (parent(dir) !== path) continue
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
    if (parent(item) !== path) continue
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
}

const INDENT_STEP = 16

function rowPaddingLeft(level: number, type: FileNode["type"]) {
  if (type === "directory") return 8 + level * INDENT_STEP
  if (level === 0) return 8
  return 8 + level * INDENT_STEP - INDENT_STEP
}

function guideLineLeft(level: number) {
  return rowPaddingLeft(level, "directory") + 8
}

export const kindLabel = (kind: Kind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return ""
}

export const kindChange = (kind: Kind) => {
  if (kind === "add") return "added"
  if (kind === "del") return "deleted"
  return "modified"
}

const FileTreeNodeV2 = (
  p: ParentProps &
    ComponentProps<"div"> &
    ComponentProps<"button"> & {
      node: FileNode
      level: number
      active?: string
      draggable: boolean
      kinds?: ReadonlyMap<string, Kind>
      marks?: Set<string>
      as?: "div" | "button"
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "draggable",
    "kinds",
    "marks",
    "as",
    "children",
    "class",
    "classList",
  ])
  const kind = () => visibleKind(local.node, local.kinds, local.marks)

  return (
    <Dynamic
      component={local.as ?? "div"}
      data-slot="file-tree-v2-row"
      data-selected={local.node.path === local.active ? "" : undefined}
      data-ignored={local.node.ignored ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={`padding-left: ${rowPaddingLeft(local.level, local.node.type)}px`}
      draggable={local.draggable}
      onDragStart={(event: DragEvent) => {
        if (!local.draggable) return
        event.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
        event.dataTransfer?.setData("text/uri-list", pathToFileUrl(local.node.path))
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
        withFileDragImage(event)
      }}
      {...rest}
    >
      {local.children}
      <span class="flex-1 min-w-0 text-12-medium whitespace-nowrap truncate">{local.node.name}</span>
      {(() => {
        const value = kind()
        if (!value || local.node.type !== "file") return null
        return (
          <span data-slot="file-tree-v2-change" data-change={kindChange(value)}>
            {kindLabel(value)}
          </span>
        )
      })()}
    </Dynamic>
  )
}

// V2-styled fork of FileTree for the review sidebar. Unlike the v1 tree it never
// lists unloaded subdirectories, so callers must pass `allowed` (nodes are
// synthesized from that list) for nested content to appear.
export default function FileTreeV2(props: {
  path: string
  active?: string
  level?: number
  allowed?: readonly string[]
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
  const level = props.level ?? 0
  const draggable = () => props.draggable ?? true

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

    const out = new Set<string>(props.kinds?.keys() ?? [])
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
    // Nodes come from the `allowed` filter; skip listing so directories that only
    // exist on the diff's base branch do not each fail with an error toast.
    for (const dir of dirs) file.tree.expand(dir, { list: false })
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

  const nodes = createMemo(() => visibleNodesForPath(props.path, file.tree.children, filter()))

  return (
    // group/file-tree-v2 scopes the group-hover guide lines below; hosts may add
    // an outer group with the same name to widen the hover area.
    <div data-component="file-tree-v2" class="group/file-tree-v2">
      <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          const deep = () => deeps().get(node.path) ?? -1
          const hasChildren = () => visibleNodesForPath(node.path, file.tree.children, filter()).length > 0
          return (
            <Switch>
              <Match when={node.type === "directory"}>
                <Collapsible
                  variant="ghost"
                  class="w-full"
                  data-scope="file-tree-v2"
                  forceMount={false}
                  open={expanded()}
                  onOpenChange={(open) =>
                    open ? file.tree.expand(node.path, { list: false }) : file.tree.collapse(node.path)
                  }
                >
                  <Collapsible.Trigger>
                    <FileTreeNodeV2
                      node={node}
                      level={level}
                      active={props.active}
                      draggable={draggable()}
                      kinds={kinds()}
                      marks={marks()}
                    >
                      <div
                        data-slot="file-tree-v2-chevron"
                        data-expanded={expanded() ? "" : undefined}
                        class="size-4 flex items-center justify-center"
                      >
                        <Icon name="chevron-down" />
                      </div>
                    </FileTreeNodeV2>
                  </Collapsible.Trigger>
                  <Show when={hasChildren()}>
                    <Collapsible.Content class="relative">
                      <div
                        classList={{
                          "absolute top-0 bottom-0 w-px pointer-events-none bg-border-weak-base opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none": true,
                          "group-hover/file-tree-v2:opacity-100": expanded() && deep() === level,
                          "group-hover/file-tree-v2:opacity-50": !(expanded() && deep() === level),
                        }}
                        style={`left: ${guideLineLeft(level)}px`}
                      />
                      <Show
                        when={level < MAX_DEPTH && !chain.includes(key(node.path))}
                        fallback={<div class="px-2 py-1 text-12-regular text-text-weak">...</div>}
                      >
                        <FileTreeV2
                          path={node.path}
                          level={level + 1}
                          allowed={props.allowed}
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
                  </Show>
                </Collapsible>
              </Match>
              <Match when={node.type === "file"}>
                <FileTreeNodeV2
                  node={node}
                  level={level}
                  active={props.active}
                  draggable={draggable()}
                  kinds={kinds()}
                  marks={marks()}
                  as="button"
                  type="button"
                  onClick={() => props.onFileClick?.(node)}
                >
                  <Show when={level > 0}>
                    <div class="w-4 shrink-0" />
                  </Show>
                  <Show
                    when={!node.ignored}
                    fallback={<FileIcon node={node} class="size-4 filetree-icon filetree-icon--mono" mono />}
                  >
                    <span class="filetree-iconpair size-4">
                      <FileIcon node={node} class="size-4 filetree-icon filetree-icon--color" />
                      <FileIcon node={node} class="size-4 filetree-icon filetree-icon--mono" mono />
                    </span>
                  </Show>
                </FileTreeNodeV2>
              </Match>
            </Switch>
          )
        }}
      </For>
    </div>
  )
}
