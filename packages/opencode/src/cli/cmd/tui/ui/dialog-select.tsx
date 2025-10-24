import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { Theme } from "@tui/context/theme"
import { entries, filter, flatMap, groupBy, pipe, take } from "remeda"
import { batch, createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"

export interface DialogSelectProps<T> {
  title: string
  options: DialogSelectOption<T>[]
  ref?: (ref: DialogSelectRef) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  keybind?: {
    keybind: Keybind.Info
    title: string
    onTrigger: (option: DialogSelectOption<T>) => void
  }[]
  limit?: number
  current?: T
}

export interface DialogSelectOption<T = any> {
  title: string
  value: T
  description?: string
  footer?: string
  category?: string
  disabled?: boolean
  bg?: string
  onSelect?: (ctx: DialogContext) => void
}

export type DialogSelectRef = {
  filter: string
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const dialog = useDialog()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
  })

  let input: InputRenderable

  const filtered = createMemo(() => {
    const needle = store.filter.toLowerCase()
    const result = pipe(
      props.options,
      filter((x) => x.disabled !== true),
      take(props.limit ?? Infinity),
      (x) => (!needle ? x : fuzzysort.go(needle, x, { keys: ["title", "category"] }).map((x) => x.obj)),
    )
    return result
  })

  const grouped = createMemo(() => {
    const result = pipe(
      filtered(),
      groupBy((x) => x.category ?? ""),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
    )
    return result
  })

  const flat = createMemo(() => {
    return pipe(
      grouped(),
      flatMap(([_, options]) => options),
    )
  })

  const dimensions = useTerminalDimensions()
  const height = createMemo(() =>
    Math.min(flat().length + grouped().length * 2 - 1, Math.floor(dimensions().height / 2) - 6),
  )

  const selected = createMemo(() => flat()[store.selected])

  createEffect(() => {
    store.filter
    setStore("selected", 0)
    scroll.scrollTo(0)
  })

  function move(direction: number) {
    let next = store.selected + direction
    if (next < 0) next = flat().length - 1
    if (next >= flat().length) next = 0
    moveTo(next)
  }

  function moveTo(next: number) {
    setStore("selected", next)
    props.onMove?.(selected()!)
    const target = scroll.getChildren().find((child) => {
      return child.id === JSON.stringify(selected()?.value)
    })
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height) {
      scroll.scrollBy(y - scroll.height + 1)
    }
    if (y < 0) {
      scroll.scrollBy(y)
      if (isDeepEqual(flat()[0].value, selected()?.value)) {
        scroll.scrollTo(0)
      }
    }
  }

  const keybind = useKeybind()
  useKeyboard((evt) => {
    if (evt.name === "up") move(-1)
    if (evt.name === "down") move(1)
    if (evt.name === "pageup") move(-10)
    if (evt.name === "pagedown") move(10)
    if (evt.name === "return") {
      const option = selected()
      if (option.onSelect) option.onSelect(dialog)
      props.onSelect?.(option)
    }

    for (const item of props.keybind ?? []) {
      if (Keybind.match(item.keybind, keybind.parse(evt))) {
        const s = selected()
        if (s) item.onTrigger(s)
      }
    }
  })

  let scroll: ScrollBoxRenderable
  const ref: DialogSelectRef = {
    get filter() {
      return store.filter
    },
  }
  props.ref?.(ref)

  return (
    <box gap={1}>
      <box paddingLeft={3} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD}>{props.title}</text>
          <text fg={Theme.textMuted}>esc</text>
        </box>
        <box paddingTop={1} paddingBottom={1}>
          <input
            onInput={(e) => {
              batch(() => {
                setStore("filter", e)
                props.onFilter?.(e)
              })
            }}
            focusedBackgroundColor={Theme.backgroundPanel}
            cursorColor={Theme.primary}
            focusedTextColor={Theme.textMuted}
            ref={(r) => {
              input = r
              input.focus()
            }}
            placeholder="Enter search term"
          />
        </box>
      </box>
      <scrollbox
        paddingLeft={2}
        paddingRight={2}
        scrollbarOptions={{ visible: false }}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        maxHeight={height()}
      >
        <For each={grouped()}>
          {([category, options], index) => (
            <>
              <Show when={category}>
                <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={1}>
                  <text fg={Theme.accent} attributes={TextAttributes.BOLD}>
                    {category}
                  </text>
                </box>
              </Show>
              <For each={options}>
                {(option) => {
                  const active = createMemo(() => isDeepEqual(option.value, selected()?.value))
                  return (
                    <box
                      id={JSON.stringify(option.value)}
                      flexDirection="row"
                      onMouseUp={() => {
                        option.onSelect?.(dialog)
                        props.onSelect?.(option)
                      }}
                      onMouseOver={() => {
                        const index = filtered().findIndex((x) => isDeepEqual(x.value, option.value))
                        if (index === -1) return
                        moveTo(index)
                      }}
                      backgroundColor={active() ? (option.bg ?? Theme.primary) : RGBA.fromInts(0, 0, 0, 0)}
                      paddingLeft={1}
                      paddingRight={1}
                      gap={1}
                    >
                      <Option
                        title={option.title}
                        footer={option.footer}
                        description={option.description !== category ? option.description : undefined}
                        active={active()}
                        current={isDeepEqual(option.value, props.current)}
                      />
                    </box>
                  )
                }}
              </For>
            </>
          )}
        </For>
      </scrollbox>
      <box paddingRight={2} paddingLeft={3} flexDirection="row" paddingBottom={1}>
        <For each={props.keybind ?? []}>
          {(item) => (
            <text>
              <span style={{ fg: Theme.text, attributes: TextAttributes.BOLD }}>{Keybind.toString(item.keybind)}</span>
              <span style={{ fg: Theme.textMuted }}> {item.title}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

function Option(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: string
  onMouseOver?: () => void
}) {
  return (
    <>
      <text
        flexGrow={1}
        fg={props.active ? Theme.background : props.current ? Theme.primary : Theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
      >
        {Locale.truncate(props.title, 62)}
        <span style={{ fg: props.active ? Theme.background : Theme.textMuted }}> {props.description}</span>
      </text>
      <Show when={props.footer}>
        <box flexShrink={0}>
          <text fg={props.active ? Theme.background : Theme.textMuted}>{props.footer}</text>
        </box>
      </Show>
    </>
  )
}
