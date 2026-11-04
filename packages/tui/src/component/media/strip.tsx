import type { MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import type { MediaItem } from "./model"
import { isMediaClick, MediaTile } from "./tile"

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
  // Square images and 16:9 videos, with cells twice as tall as wide.
  const tileWidth = (item: MediaItem) => Math.round(props.height * (item.kind === "video" ? 32 / 9 : 2))
  const more = () => `+${props.items.length - count()} more`
  const reserve = () => `+${props.items.length} more`.length + 3
  const count = createMemo(() => {
    // Each tile takes its width plus a one-cell gap; all but the last item leave room for the "+N more" tile.
    let used = -1
    const end = props.items.findIndex((item, index) => {
      used += tileWidth(item) + 1
      return used + (index < props.items.length - 1 ? reserve() : 0) > props.width
    })
    return end === -1 ? props.items.length : Math.max(1, end)
  })
  // A lone tile that does not fit shrinks to the space beside the "+N more" tile.
  const room = () => Math.max(4, props.width - (count() < props.items.length ? reserve() : 0))

  return (
    <box flexDirection="row" flexShrink={0} gap={1}>
      <For each={props.items.slice(0, count())}>
        {(item, index) => (
          <MediaTile
            item={item}
            width={Math.min(room(), tileWidth(item))}
            height={props.height}
            onOpen={() => props.onOpen(index())}
          />
        )}
      </For>
      <Show when={count() < props.items.length}>
        <box
          width={more().length + 2}
          height={props.height}
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
