/** @jsxImportSource @opentui/solid */
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core"
import { Locale } from "@/util/locale"
import { createEffect, createMemo, For, Match, Switch } from "solid-js"
import { buildFileTree, flattenFileTree, type FileTreeItem } from "./diff-viewer-file-tree-utils"

const FILE_TREE_WIDTH = 32
const FILE_TREE_HORIZONTAL_PADDING = 2

export type DiffViewerFileTreeTheme = {
  readonly background: ColorInput
  readonly backgroundPanel: ColorInput
  readonly backgroundElement: ColorInput
  readonly primary: ColorInput
  readonly selectedListItemText: ColorInput
  readonly text: ColorInput
  readonly textMuted: ColorInput
  readonly error: ColorInput
}

export type DiffViewerFileTreeProps = {
  readonly files: readonly FileTreeItem[]
  readonly loading: boolean
  readonly error: unknown
  readonly theme: DiffViewerFileTreeTheme
  readonly focused?: boolean
  readonly highlightedNode?: number
  readonly expandedNodes?: ReadonlySet<number>
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

  return (
    <box
      width={FILE_TREE_WIDTH}
      flexShrink={0}
      backgroundColor={props.theme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      gap={1}
      minHeight={0}
    >
      <scrollbox
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
            <text fg={props.theme.text}>No files</text>
          </Match>
          <Match when={props.files.length > 0}>
            <For each={rows()}>
              {(row) => {
                const highlighted = () => props.focused && props.highlightedNode === row.id
                const prefix = () =>
                  `${"  ".repeat(row.depth)}${row.kind === "directory" ? (props.expandedNodes && !props.expandedNodes.has(row.id) ? "▸ " : "▾ ") : "  "}`
                const name = () =>
                  Locale.truncate(
                    row.name,
                    Math.max(1, FILE_TREE_WIDTH - FILE_TREE_HORIZONTAL_PADDING - prefix().length),
                  )
                return (
                  <box flexDirection="row" width="100%">
                    <text
                      fg={
                        highlighted()
                          ? props.theme.background
                          : row.kind === "directory"
                            ? props.theme.textMuted
                            : props.theme.text
                      }
                      bg={highlighted() ? props.theme.primary : undefined}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {prefix()}
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text
                        fg={
                          highlighted()
                            ? props.theme.background
                            : row.kind === "directory"
                              ? props.theme.textMuted
                              : props.theme.text
                        }
                        bg={highlighted() ? props.theme.primary : undefined}
                        wrapMode="none"
                      >
                        {name()}
                      </text>
                    </box>
                  </box>
                )
              }}
            </For>
          </Match>
        </Switch>
      </scrollbox>
    </box>
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
