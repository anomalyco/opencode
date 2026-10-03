import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  splitProps,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import type { ChangeKind } from "../review/contract"
import { Native, useExtension, type FileNode, type SessionView } from "../sdk"
import { startFileDrag } from "./drag"
import { OpenInAppContextMenuV2, useOpenInApp } from "./open-in-app"
import { resolveOpenInAppPath } from "./path"
import {
  buildFileTreeV2Model,
  flattenFileTreeV2,
  flattenLiveFileTreeV2,
  normalizeFileTreeV2Path,
  type FileTreeV2Node,
} from "./tree-model"

const INDENT_STEP = 16

export function virtualScrollElement(root: HTMLElement | undefined) {
  if (!root?.isConnected) return null
  return root.closest<HTMLDivElement>(".scroll-view__viewport")
}

function rowPaddingStart(level: number, type: FileNode["type"]) {
  if (type === "directory") return 8 + level * INDENT_STEP
  if (level === 0) return 8
  return 8 + level * INDENT_STEP - INDENT_STEP
}

function guideLineStart(level: number) {
  return rowPaddingStart(level, "directory") + 8
}

export const kindLabel = (kind: ChangeKind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

export const kindChange = (kind: ChangeKind) => {
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
      kinds?: ReadonlyMap<string, ChangeKind>
      as?: "div" | "button"
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "draggable",
    "kinds",
    "as",
    "children",
    "class",
    "classList",
  ])
  const kind = () => local.kinds?.get(normalizeFileTreeV2Path(local.node.path))

  return (
    <Dynamic
      component={local.as ?? "div"}
      data-slot="file-tree-v2-row"
      data-path={local.node.path}
      data-selected={local.node.path === local.active ? "" : undefined}
      data-ignored={local.node.ignored ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={`padding-inline-start: ${rowPaddingStart(local.level, local.node.type)}px`}
      draggable={local.draggable}
      onDragStart={(event: DragEvent) => {
        if (!local.draggable) return
        startFileDrag(event, local.node.path)
      }}
      {...rest}
    >
      {local.children}
      <span data-slot="file-tree-v2-label" class="flex-1 shrink-0 text-start text-12-medium whitespace-nowrap">
        <bdi dir="auto">
          {local.node.type === "directory"
            ? normalizeFileTreeV2Path(local.node.path).split("/").at(-1)
            : local.node.name}
        </bdi>
      </span>
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

function GuideLines(props: { level: number }) {
  return (
    <For each={Array.from({ length: props.level })}>
      {(_, index) => <div data-slot="file-tree-v2-guide" style={`inset-inline-start: ${guideLineStart(index())}px`} />}
    </For>
  )
}

export default function FileTreeV2(props: {
  session: SessionView
  active?: string
  allowed?: readonly string[]
  kinds?: ReadonlyMap<string, ChangeKind>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void
  onFileDoubleClick?: (file: FileNode) => void
}) {
  const ctx = useExtension()
  const file = props.session.file
  const openIn = ctx.use(Native) ? useOpenInApp({ session: props.session, path: () => file.root }) : undefined
  const live = () => props.allowed === undefined
  const draggable = () => props.draggable ?? true
  const active = () => normalizeFileTreeV2Path(props.active ?? "")
  const model = createMemo(() => (live() ? undefined : buildFileTreeV2Model(props.allowed ?? [])))
  const expanded = (path: string) => file.tree.state(path)?.expanded ?? !live()
  const rows = createMemo(() => {
    if (live()) return flattenLiveFileTreeV2((path) => file.tree.list(path), expanded)
    return flattenFileTreeV2(model()!, expanded)
  })
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [focused, setFocused] = createSignal<string>()
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return rows().length
    },
    getScrollElement: () => virtualScrollElement(root()),
    initialRect: { width: 0, height: 600 },
    estimateSize: () => 28,
    gap: 2,
    overscan: 10,
    get getItemKey() {
      const current = rows()
      return (index: number) => current[index]?.node.path ?? index
    },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const path = focused()
      const index = path ? rows().findIndex((row) => row.node.path === path) : -1
      if (index < 0 || indexes.includes(index)) return indexes
      return [...indexes, index].sort((a, b) => a - b)
    },
  })

  createEffect(() => {
    if (!live()) return
    void file.tree.sync("")
  })

  // Only scroll when the active path changes (or first appears in the tree).
  // Do not re-scroll when expand/collapse reshuffles `rows()`.
  const scrolled = { active: undefined as string | undefined }
  createEffect(() => {
    const path = active()
    if (!path) {
      scrolled.active = undefined
      return
    }
    const index = rows().findIndex((row) => row.node.path === path)
    if (index < 0) return
    if (scrolled.active === path) return
    scrolled.active = path
    queueMicrotask(() => {
      const next = rows().findIndex((row) => row.node.path === path)
      if (next < 0) return
      if (virtualizer.range && next >= virtualizer.range.startIndex && next <= virtualizer.range.endIndex) return
      virtualizer.scrollToIndex(next, { align: "auto" })
    })
  })

  const selectFile = (node: FileTreeV2Node, action?: (file: FileNode) => void) => {
    action?.({
      ...node,
      path: node.originalPath,
      absolute: node.originalPath,
    })
  }

  const toggleDirectory = (path: string, originalPath: string) => {
    if (expanded(path)) {
      file.tree.collapse(originalPath)
      return
    }
    file.tree.expand(originalPath, live() ? undefined : { list: false })
  }

  const rowByKey = createMemo(() => new Map(rows().map((row) => [row.node.path, row] as const)))
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key))

  createEffect(() => {
    rows()
    const element = root()
    if (!element) return
    element.style.removeProperty("width")
    syncFileTreeV2Width(element)
  })

  createEffect(() => {
    virtualRowKeys()
    syncFileTreeV2Width(root())
  })

  return (
    <div
      ref={setRoot}
      data-component="file-tree-v2"
      data-total-rows={live() ? rows().length : model()!.total}
      class="group/file-tree-v2"
      style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}
    >
      <For each={virtualRowKeys()}>
        {(key) => (
          <Show when={virtualItemByKey().get(key)}>
            {(item) => (
              <div
                style={{
                  position: "absolute",
                  top: "0",
                  "inset-inline-start": "0",
                  width: "100%",
                  "min-width": "max-content",
                  height: `${item().size}px`,
                  transform: `translateY(${item().start}px)`,
                }}
              >
                <Show when={rowByKey().get(key as string)}>
                  {(row) => (
                    <Show
                      when={row().node.type === "directory"}
                      fallback={
                        <OpenInAppContextMenuV2
                          state={openIn}
                          path={() => resolveOpenInAppPath(file.root, row().node.absolute || row().node.originalPath)}
                        >
                          <FileTreeNodeV2
                            node={row().node}
                            level={row().level}
                            active={active()}
                            draggable={draggable()}
                            kinds={props.kinds}
                            as="button"
                            type="button"
                            class="relative"
                            onFocus={() => setFocused(row().node.path)}
                            onBlur={() => setFocused(undefined)}
                            onClick={() => selectFile(row().node, props.onFileClick)}
                            onDblClick={() => selectFile(row().node, props.onFileDoubleClick)}
                          >
                            <GuideLines level={row().level} />
                            <Show when={row().level > 0}>
                              <div class="w-4 shrink-0" />
                            </Show>
                            <span class="filetree-iconpair size-4">
                              <FileIcon node={row().node} class="size-4 filetree-icon filetree-icon--color" />
                              <FileIcon node={row().node} class="size-4 filetree-icon filetree-icon--mono" mono />
                            </span>
                          </FileTreeNodeV2>
                        </OpenInAppContextMenuV2>
                      }
                    >
                      <FileTreeNodeV2
                        node={row().node}
                        level={row().level}
                        active={active()}
                        draggable={draggable()}
                        kinds={props.kinds}
                        as="button"
                        type="button"
                        class="relative"
                        onFocus={() => setFocused(row().node.path)}
                        onBlur={() => setFocused(undefined)}
                        aria-expanded={expanded(row().node.path)}
                        onClick={() => toggleDirectory(row().node.path, row().node.originalPath)}
                      >
                        <GuideLines level={row().level} />
                        <div
                          data-slot="file-tree-v2-chevron"
                          data-expanded={expanded(row().node.path) ? "" : undefined}
                          class="size-4 flex items-center justify-center"
                        >
                          <Icon name="chevron-down" />
                        </div>
                      </FileTreeNodeV2>
                    </Show>
                  )}
                </Show>
              </div>
            )}
          </Show>
        )}
      </For>
    </div>
  )
}

export function syncFileTreeV2Width(element?: HTMLDivElement) {
  if (!element) return
  queueMicrotask(() => {
    if (!element.isConnected) return
    const width = Math.max(element.clientWidth, ...Array.from(element.children, (child) => child.scrollWidth))
    if (width <= element.clientWidth) return
    element.style.width = `${width}px`
  })
}
