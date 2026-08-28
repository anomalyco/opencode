/** @jsxImportSource @opentui/solid */
import { MouseButton, TextAttributes, type MouseEvent, type ScrollBoxRenderable } from "@opentui/core"
import { truncateFilePath } from "../../ui/file-path"
import { stringWidth } from "../../util/string-width"
import { useTheme } from "../../context/theme"
import { tint } from "../../theme/color"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { buildFileTree, flattenFileTree, type FileTreeItem, type FileTreeRow } from "./diff-viewer-file-tree-utils"

const FILE_TREE_STATUS_WIDTH = 1

export type DiffViewerFileTreeProps = {
  readonly width: number
  readonly files: readonly FileTreeItem[]
  readonly loading: boolean
  readonly error: unknown
  readonly layout?: "tree" | "list"
  readonly selectedFileIndex?: number
  readonly reviewedFileNames?: ReadonlySet<string>
  readonly expandedNodes?: ReadonlySet<number>
  readonly onRowClick?: (row: FileTreeRow) => void
  readonly onFileContextMenu?: (fileIndex: number, event: MouseEvent) => void
  readonly source?: string
  readonly onSwitchSource?: () => void
  readonly footer?: JSX.Element
}

export function DiffViewerFileTree(props: DiffViewerFileTreeProps) {
  const theme = useTheme("elevated")
  const [sourceHovered, setSourceHovered] = createSignal(false)
  const list = () => props.layout === "list"
  const tree = createMemo(() => buildFileTree(props.files))
  const rows = createMemo(() =>
    list()
      ? flattenFileTree(tree()).filter((row) => row.fileIndex !== undefined)
      : flattenFileTree(tree(), props.expandedNodes),
  )
  // Quieter than subdued text: markers are affordances, not content.
  const faint = createMemo(() => tint(theme.text.subdued, theme.background.default, 0.45))
  // Rails are pure texture; keep them barely above the surface.
  const rail = createMemo(() => tint(theme.text.subdued, theme.background.default, 0.7))
  const reviewedCount = createMemo(() => props.files.filter((file) => props.reviewedFileNames?.has(file.file)).length)
  const contentWidth = () => Math.max(0, props.width - 4 - FILE_TREE_STATUS_WIDTH - 1)
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    const index = rows().findIndex((row) => row.fileIndex !== undefined && row.fileIndex === props.selectedFileIndex)
    if (index === -1) return
    const top = index * (list() ? 3 : 1)
    const height = list() ? 2 : 1
    const scrollSelectedIntoView = () => scrollFileTreeRowIntoView(scroll, top, height)
    scrollSelectedIntoView()
    requestAnimationFrame(scrollSelectedIntoView)
  })

  return (
    <box width={props.width} height="100%" minWidth={0} minHeight={0} flexShrink={0} flexDirection="column">
      <box id="diff-tree-top-edge" height={1} flexShrink={0} backgroundColor={theme.background.default} />
      <box
        flexGrow={1}
        minWidth={0}
        minHeight={0}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={theme.background.default}
      >
        <box height={1} flexShrink={0} flexDirection="row" marginBottom={1} gap={1}>
          <text
            id="diff-source-switch"
            fg={
              props.onSwitchSource
                ? sourceHovered()
                  ? theme.text.action.secondary.hovered
                  : theme.text.action.secondary.default
                : theme.text.default
            }
            attributes={TextAttributes.BOLD}
            flexGrow={1}
            wrapMode="none"
            truncate
            selectable={false}
            onMouseOver={() => setSourceHovered(true)}
            onMouseOut={() => setSourceHovered(false)}
            onMouseUp={(event) => {
              if (event.button !== MouseButton.LEFT) return
              event.stopPropagation()
              props.onSwitchSource?.()
            }}
          >
            {props.source ?? "Files"}
          </text>
          <text fg={theme.text.subdued} wrapMode="none" flexShrink={0}>
            {reviewedCount()}/{props.files.length} reviewed
          </text>
        </box>
        <scrollbox
          id="diff-files"
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          flexGrow={1}
          minHeight={0}
          verticalScrollbarOptions={{ visible: false }}
          horizontalScrollbarOptions={{ visible: false }}
        >
          <Switch>
            <Match when={props.loading || props.error}>
              <text />
            </Match>
            <Match when={props.files.length === 0}>
              <text fg={theme.text.subdued}>No files</text>
            </Match>
            <Match when={props.files.length > 0}>
              <box flexShrink={0} gap={list() ? 1 : 0}>
                <For each={rows()}>
                  {(row) => {
                    const [hovered, setHovered] = createSignal(false)
                    const selected = () => row.fileIndex !== undefined && props.selectedFileIndex === row.fileIndex
                    const reviewed = () => {
                      const file = row.fileIndex === undefined ? undefined : props.files[row.fileIndex]?.file
                      return file !== undefined && (props.reviewedFileNames?.has(file) ?? false)
                    }
                    const foreground = () => {
                      if (row.kind === "directory") return theme.text.subdued
                      return reviewed() ? theme.text.subdued : theme.text.default
                    }
                    const background = () => {
                      // Elevated context maps this to a quiet neutral surface step, not the loud accent.
                      if (hovered()) return theme.background.action.primary.hovered
                      return theme.background.default
                    }
                    const marker = () => {
                      if (row.kind !== "directory") return "≡ "
                      return props.expandedNodes && !props.expandedNodes.has(row.id) ? "▸ " : "▾ "
                    }
                    // Rails run straight down from each ancestor folder; no end hooks.
                    const indent = createMemo(() => {
                      if (list()) return ""
                      return "│ ".repeat(Math.max(0, Math.min(row.depth, Math.floor((contentWidth() - 3) / 2))))
                    })
                    const status = () => fileTreeRowStatus(row, props.files, reviewed())
                    const statusColor = () => {
                      if (reviewed()) return theme.text.subdued
                      const status = row.fileIndex === undefined ? undefined : props.files[row.fileIndex]?.status
                      if (status === "added") return theme.diff.text.added
                      if (status === "deleted") return theme.diff.text.removed
                      return theme.text.subdued
                    }
                    const name = () => {
                      const width = contentWidth() - stringWidth(indent()) - stringWidth(marker())
                      if (row.kind === "directory") return truncateDirectoryChain(row.name, width)
                      return truncateFilePath(row.name, width)
                    }
                    const parent = () => {
                      const file = row.fileIndex === undefined ? "" : (props.files[row.fileIndex]?.file ?? "")
                      const directory = file.slice(0, Math.max(0, file.lastIndexOf("/")))
                      return directory ? truncateDirectoryChain(directory, contentWidth() - stringWidth(marker())) : ""
                    }
                    return (
                      <box
                        id={
                          row.fileIndex === undefined ? `diff-folder-row-${row.id}` : `diff-file-row-${row.fileIndex}`
                        }
                        flexDirection="column"
                        width="100%"
                        height={list() ? 2 : 1}
                        flexShrink={0}
                        backgroundColor={background()}
                        onMouseOver={() => setHovered(true)}
                        onMouseOut={() => setHovered(false)}
                        onMouseDown={(event) => {
                          if (row.fileIndex !== undefined) props.onFileContextMenu?.(row.fileIndex, event)
                        }}
                        onMouseUp={(event) => {
                          if (event.button !== MouseButton.LEFT) return
                          event.stopPropagation()
                          props.onRowClick?.(row)
                        }}
                      >
                        <box flexDirection="row" height={1}>
                          <text wrapMode="none" flexShrink={0}>
                            <span style={{ fg: rail() }}>{indent()}</span>
                            <span style={{ fg: faint() }}>{marker()}</span>
                          </text>
                          <box flexGrow={1} minWidth={0} marginRight={1}>
                            <text
                              fg={foreground()}
                              attributes={selected() ? TextAttributes.BOLD : undefined}
                              wrapMode="none"
                              truncate
                            >
                              {name()}
                            </text>
                          </box>
                          <text fg={statusColor()} wrapMode="none" width={FILE_TREE_STATUS_WIDTH} flexShrink={0}>
                            {status()}
                          </text>
                        </box>
                        <Show when={list()}>
                          <text
                            fg={foreground()}
                            attributes={selected() || hovered() ? TextAttributes.DIM : undefined}
                            marginLeft={stringWidth(marker())}
                            wrapMode="none"
                            truncate
                          >
                            {parent()}
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Match>
          </Switch>
        </scrollbox>
        <Show when={props.footer}>
          <box flexShrink={0} paddingTop={1} paddingBottom={1}>
            {props.footer}
          </box>
        </Show>
      </box>
    </box>
  )
}

function scrollFileTreeRowIntoView(scroll: ScrollBoxRenderable | undefined, top: number, height: number) {
  if (!scroll || scroll.isDestroyed) return
  if (top < scroll.scrollTop) {
    scroll.scrollTo(top)
    return
  }
  if (top + height > scroll.scrollTop + scroll.viewport.height) {
    scroll.scrollTo(top + height - scroll.viewport.height)
  }
}

function fileTreeRowStatus(row: FileTreeRow, files: readonly FileTreeItem[], reviewed: boolean) {
  if (row.fileIndex === undefined) return ""
  if (reviewed) return "✓"
  const status = files[row.fileIndex]?.status
  return status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : "?"
}

// Collapsed chains drop whole leading segments instead of squeezing
// mid-segment, so "a/b/c/d" narrows to "…/c/d" rather than "…/b…/c/d".
function truncateDirectoryChain(name: string, maxWidth: number) {
  if (stringWidth(name) <= maxWidth) return name
  const kept: string[] = []
  let width = stringWidth("…/")
  for (const segment of name.split("/").toReversed()) {
    const next = stringWidth(segment) + (kept.length ? 1 : 0)
    if (width + next > maxWidth) break
    kept.unshift(segment)
    width += next
  }
  if (kept.length === 0) return truncateFilePath(name, maxWidth)
  return `…/${kept.join("/")}`
}
