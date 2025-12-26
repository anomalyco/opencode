import { createMemo, createSignal, createEffect, For, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createStore } from "solid-js/store"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import type { PromptInfo } from "./prompt/history"
import * as fuzzysort from "fuzzysort"

export interface DialogHistorySearchProps {
  items: PromptInfo[]
  onSelect: (item: PromptInfo) => void
}

export function DialogHistorySearch(props: DialogHistorySearchProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
  })

  const items = createMemo(() => {
    const seen = new Set<string>()
    return props.items
      .slice()
      .reverse()
      .filter((item) => {
        if (!item.input.trim().length) return false
        if (seen.has(item.input)) return false
        seen.add(item.input)
        return true
      })
  })

  const filtered = createMemo(() => {
    const query = store.filter.toLowerCase()
    if (!query) return items().map((item) => ({ item, match: undefined as any }))

    const results = fuzzysort.go(query, items(), {
      keys: ["input"],
      limit: 200,
    })

    return results.map((result) => ({
      item: result.obj,
      match: result[0],
    }))
  })

  const dimensions = useTerminalDimensions()
  const height = createMemo(() => Math.min(filtered().length, Math.floor(dimensions().height / 2) - 8))

  const selected = createMemo(() => filtered()[store.selected])

  createEffect(() => {
    if (store.filter.length > 0) setStore("selected", 0)
    scroll?.scrollTo(0)
  })

  function move(direction: number) {
    let next = store.selected + direction
    if (next < 0) next = filtered().length - 1
    if (next >= filtered().length) next = 0
    moveTo(next)
  }

  function moveTo(next: number) {
    setStore("selected", next)
    if (!scroll) return
    const target = scroll.getChildren().find((child) => {
      return child.id === JSON.stringify(selected()?.item)
    })
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height) {
      scroll.scrollBy(y - scroll.height + 1)
    }
    if (y < 0) {
      scroll.scrollBy(y)
      if (filtered()[0].item === selected()?.item) {
        scroll.scrollTo(0)
      }
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) move(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
    if (evt.name === "pageup") move(-10)
    if (evt.name === "pagedown") move(10)
    if (evt.ctrl && evt.name === "u") {
      setStore("filter", "")
      setStore("selected", 0)
      scroll?.scrollTo(0)
    }
    if (evt.name === "return") {
      const option = selected()
      if (option) {
        props.onSelect(option.item)
        dialog.clear()
      }
    }
  })

  let input: InputRenderable
  let scroll: ScrollBoxRenderable

  const fg = selectedForeground(theme)

  const matchedText = createMemo(() => {
    const match = selected()?.match
    if (!match || !match.indexes || match.indexes.length === 0) return ""
    const item = selected()?.item
    if (!item) return ""

    const startIndex = Math.max(0, match.indexes[0] - 50)
    const endIndex = Math.min(item.input.length, match.indexes[match.indexes.length - 1] + 50)
    let text = item.input.slice(startIndex, endIndex)
    if (startIndex > 0) text = "..." + text
    if (endIndex < item.input.length) text = text + "..."
    return text
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Search History
          </text>
          <text fg={theme.textMuted}>
            ctrl+u clear
            {"  "}
            esc
          </text>
        </box>
        <box paddingTop={1} paddingBottom={1}>
          <input
            value={store.filter}
            onInput={(e) => {
              setStore("filter", e)
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r) => {
              input = r
              setTimeout(() => input.focus(), 1)
            }}
            placeholder="Type to search..."
          />
        </box>
      </box>
      <scrollbox
        paddingLeft={1}
        paddingRight={1}
        scrollbarOptions={{ visible: false }}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        maxHeight={height()}
      >
        <For each={filtered()}>
          {(option, index) => (
            <box
              id={JSON.stringify(option.item)}
              flexDirection="row"
              onMouseUp={() => {
                props.onSelect(option.item)
                dialog.clear()
              }}
              onMouseOver={() => {
                const idx = index()
                if (idx === -1) return
                moveTo(idx)
              }}
              backgroundColor={index() === store.selected ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
              paddingLeft={3}
              paddingRight={3}
              gap={1}
            >
              <text
                flexGrow={1}
                fg={index() === store.selected ? fg : theme.text}
                attributes={index() === store.selected ? TextAttributes.BOLD : undefined}
                overflow="hidden"
                paddingLeft={3}
              >
                {Locale.truncate(option.item.input, 61)}
              </text>
            </box>
          )}
        </For>
      </scrollbox>
      <Show when={matchedText()}>
        <box paddingRight={2} paddingLeft={4} flexShrink={0} paddingTop={1}>
          <text fg={theme.textMuted}>Match: </text>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            {matchedText()}
          </text>
        </box>
      </Show>
    </box>
  )
}
