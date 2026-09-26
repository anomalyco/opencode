/** @jsxImportSource @opentui/solid */
import type { ColorInput, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { Locale } from "../../util/locale"
import { tint } from "../../context/theme"
import { createEffect, createMemo, For, Match, Switch } from "solid-js"
import { buildFileTree, flattenFileTree, type FileTreeItem, type FileTreeRow } from "./diff-viewer-file-tree-utils"
import { Panel } from "./diff-viewer-ui"

const FILE_TREE_STATUS_WIDTH = 2

export type DiffViewerFileTreeTheme = {
  readonly background: RGBA
  readonly backgroundPanel: ColorInput
  readonly backgroundElement: ColorInput
  readonly primary: ColorInput
  readonly secondary: ColorInput
  readonly selectedListItemText: ColorInput
  readonly text: RGBA
  readonly textMuted: RGBA
  readonly error: ColorInput
}

export type DiffViewerFileTreeProps = {
  readonly width: number
  readonly files: readonly FileTreeItem[]
  readonly loading: boolean
  readonly error: unknown
  readonly theme: DiffViewerFileTreeTheme
  readonly focused?: boolean
  readonly highlightedNode?: number
  readonly selectedFileIndex?: number
  readonly reviewedFileNames?: ReadonlySet<string>
  readonly expandedNodes?: ReadonlySet<number>
  readonly onRowClick?: (row: FileTreeRow) => void
}

export function DiffViewerFileTree(props: DiffViewerFileTreeProps) {
  const tree = createMemo(() => buildFileTree(props.files))
  const rows = createMemo(() => flattenFileTree(tree(), props.expandedNodes))
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    const node = props.highlightedNode
    if (node === undefined) return
    const selectedIndex = rows().findIndex((row) => row.id === node)
    if (selectedIndex === -1) return
    const scrollSelectedIntoView = () => scrollFileTreeRowIntoView(scroll, selectedIndex)
    scrollSelectedIntoView()
    requestAnimationFrame(scrollSelectedIntoView)
  })

  const fadedColor = () => tint(props.theme.text, props.theme.background, 0.75)

  return (
    <Panel border="both" width={props.width}>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <Switch>
          <Match when={props.loading || props.error}>
            <text />
          </Match>
          <Match when={props.files.length === 0}>
            <text fg={props.theme.text}>No files</text>
          </Match>
          <Match when={props.files.length > 0}>
            <For each={rows()}>
              {(row, index) => {
                const highlighted = () => props.focused && props.highlightedNode === row.id
                const selected = () => row.fileIndex !== undefined && props.selectedFileIndex === row.fileIndex
                const reviewed = () => {
                  const file = row.fileIndex === undefined ? undefined : props.files[row.fileIndex]?.file
                  return file !== undefined && (props.reviewedFileNames?.has(file) ?? false)
                }
                const prefix = () => fileTreeRowPrefix(rows(), index(), row, props.expandedNodes)
                const status = () => fileTreeRowStatus(row, props.files, reviewed())
                const name = () =>
                  Locale.truncate(row.name, Math.max(1, props.width - FILE_TREE_STATUS_WIDTH - prefix().length))
                return (
                  <box
                    flexDirection="row"
                    width="100%"
                    backgroundColor={highlighted() ? props.theme.primary : undefined}
                    onMouseUp={() => props.onRowClick?.(row)}
                  >
                    <text fg={highlighted() ? props.theme.background : fadedColor()} wrapMode="none" flexShrink={0}>
                      {prefix()}
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text
                        fg={
                          highlighted()
                            ? props.theme.background
                            : selected()
                              ? props.theme.primary
                              : reviewed() || row.kind === "directory"
                                ? props.theme.textMuted
                                : props.theme.text
                        }
                        wrapMode="none"
                      >
                        {name()}
                      </text>
                    </box>
                    <text
                      fg={highlighted() ? props.theme.background : props.theme.textMuted}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {status()}
                    </text>
                  </box>
                )
              }}
            </For>
          </Match>
        </Switch>
      </scrollbox>
    </Panel>
  )
}

function scrollFileTreeRowIntoView(scroll: ScrollBoxRenderable | undefined, index: number) {
  if (!scroll) return
  if (index < scroll.scrollTop) {
    scroll.scrollTo(index)
    return
  }
  if (index >= scroll.scrollTop + scroll.viewport.height) {
    scroll.scrollTo(index - scroll.viewport.height + 1)
  }
}

function fileTreeRowPrefix(
  rows: readonly FileTreeRow[],
  index: number,
  row: FileTreeRow,
  expandedNodes: ReadonlySet<number> | undefined,
) {
  const indentation = Array.from({ length: row.depth }, (_, depth) => {
    if (depth === 0 && !hasLaterSibling(rows, 0, 0)) return " "
    return hasLaterSibling(rows, index, depth) ? "│  " : "   "
  }).join("")
  const topRoot = index === 0 && row.depth === 0
  const branch = topRoot ? " " : hasLaterSibling(rows, index, row.depth) ? "├─ " : "└─ "
  const marker = row.kind === "directory" ? (expandedNodes && !expandedNodes.has(row.id) ? "▸ " : "▾ ") : ""

  return `${indentation}${branch}${marker}`
}

function hasLaterSibling(rows: readonly FileTreeRow[], index: number, depth: number) {
  return rows.slice(index + 1).find((row) => row.depth <= depth)?.depth === depth
}

function fileTreeRowStatus(row: FileTreeRow, files: readonly FileTreeItem[], reviewed: boolean) {
  if (row.fileIndex === undefined) return ""
  const status = files[row.fileIndex]?.status
  const marker = status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : "?"
  return `${reviewed ? "✓" : " "}${marker}`.padStart(FILE_TREE_STATUS_WIDTH)
}
