/** @jsxImportSource @opentui/solid */
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, For, Match, Switch } from "solid-js"
import { buildFileTree, flattenFileTree, type FileTreeItem } from "./diff-viewer-file-tree-utils"

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
      width={32}
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
                return (
                  <box flexDirection="row">
                    <text fg={row.kind === "directory" ? props.theme.textMuted : props.theme.text} wrapMode="none">
                      {`${"  ".repeat(row.depth)}${row.kind === "directory" ? (props.expandedNodes && !props.expandedNodes.has(row.id) ? "▸ " : "▾ ") : "  "}`}
                    </text>
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
                      {row.name}
                    </text>
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
