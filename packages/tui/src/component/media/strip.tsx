import type { MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import type { MediaItem } from "./model"
import { isMediaClick, MediaTile } from "./tile"

/** Cells wide for a tile `height` cells tall: square images and 16:9 videos, with cells twice as tall as wide. */
function mediaTileWidth(item: MediaItem, height: number) {
  return Math.round(height * (item.kind === "video" ? 32 / 9 : 2))
}

/**
 * `next` with each item that shows the same file as the previous item with its id replaced by that item, or `previous`
 * when nothing changed, so a strip keeps its mounted tiles when its items are collected again.
 */
export function keepMediaItems(previous: readonly MediaItem[], next: readonly MediaItem[]) {
  const ids = new Map(previous.map((item) => [item.id, item]))
  const items = next.map((item) => {
    const old = ids.get(item.id)
    return old &&
      (old.path ? old.path === item.path : old.uri === item.uri) &&
      old.location?.directory === item.location?.directory &&
      old.location?.workspaceID === item.location?.workspaceID
      ? old
      : item
  })
  return items.length === previous.length && items.every((item, index) => item === previous[index]) ? previous : items
}

/**
 * A row of media tiles holding as many items as fit in `width` cells. When some do not fit, a "+N more" tile opens the
 * first hidden one. `onOpen` receives the index of the opened item in `items`.
 */
export function MediaStrip(props: {
  items: readonly MediaItem[]
  width: number
  height: number
  onOpen: (index: number) => void
}) {
  const theme = useTheme()
  const renderer = useRenderer()
  const more = () => `+${props.items.length - count()} more`
  const reserve = () => `+${props.items.length} more`.length + 3
  const count = createMemo(() => {
    const widths = props.items.map((item) => mediaTileWidth(item, props.height))
    const last = widths.length - 1
    // Each tile takes its width plus a one-cell gap; all but the last item leave room for the "+N more" tile.
    const end = widths.findIndex(
      (_, index) =>
        widths.slice(0, index + 1).reduce((sum, width) => sum + width + 1, -1) + (index < last ? reserve() : 0) >
        props.width,
    )
    return end === -1 ? widths.length : Math.max(1, end)
  })
  // A lone tile that does not fit shrinks to the space beside the "+N more" tile.
  const room = () => Math.max(4, props.width - (count() < props.items.length ? reserve() : 0))

  return (
    <box flexDirection="row" flexShrink={0} gap={1}>
      <For each={props.items.slice(0, count())}>
        {(item, index) => (
          <MediaTile
            item={item}
            width={Math.min(room(), mediaTileWidth(item, props.height))}
            height={props.height}
            onOpen={() => props.onOpen(index())}
          />
        )}
      </For>
      <Show when={count() < props.items.length}>
        <box
          width={more().length + 2}
          height={props.height}
          flexShrink={0}
          alignItems="center"
          justifyContent="center"
          backgroundColor={theme.background.raised.base}
          onMouseUp={(event: MouseEvent) => {
            if (!isMediaClick(renderer, event)) return
            event.stopPropagation()
            props.onOpen(count())
          }}
        >
          <text fg={theme.text.muted} wrapMode="none" selectable={false}>
            {more()}
          </text>
        </box>
      </Show>
    </box>
  )
}
