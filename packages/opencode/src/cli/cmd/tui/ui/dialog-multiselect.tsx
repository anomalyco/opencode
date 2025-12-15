import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { useDialog } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"

export interface DialogMultiSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogMultiSelectOption<T>[]
  ref?: (ref: DialogMultiSelectRef<T>) => void
  onMove?: (option: DialogMultiSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (selected: T[]) => void
  keybind?: {
    keybind: Keybind.Info
    title: string
    disabled?: boolean
    onTrigger: (option?: DialogMultiSelectOption<T>) => void
  }[]
  current?: T[]
  hideSearch?: boolean
  beforeFooter?: JSX.Element
}

export interface DialogMultiSelectOption<T = any> {
  title: string
  value: T
  description?: string
  footer?: JSX.Element | string
  category?: string
  disabled?: boolean
  bg?: RGBA
  gutter?: JSX.Element
}

export type DialogMultiSelectRef<T> = {
  filter: string
  filtered: DialogMultiSelectOption<T>[]
}

export function DialogMultiSelect<T>(props: DialogMultiSelectProps<T>) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
  })
  const [selectedValues, setSelectedValues] = createStore<Record<string, boolean>>({})

  // Initialize selected values from current array
  createEffect(() => {
    if (props.current && props.current.length > 0) {
      const newSelected: Record<string, boolean> = {}
      for (const val of props.current) {
        newSelected[JSON.stringify(val)] = true
      }
      setSelectedValues(newSelected)
    }
  })

  const isSelected = (value: T) => selectedValues[JSON.stringify(value)] ?? false

  let input: InputRenderable

  const filtered = createMemo(() => {
    const needle = store.filter.toLowerCase()
    const result = pipe(
      props.options,
      filter((x) => x.disabled !== true),
      (x) => (!needle ? x : fuzzysort.go(needle, x, { keys: ["title", "category"] }).map((x) => x.obj)),
    )
    return result
  })

  const grouped = createMemo(() => {
    const result = pipe(
      filtered(),
      groupBy((x) => x.category ?? ""),
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
    if (store.filter.length > 0) {
      setStore("selected", 0)
    }
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

  function toggleSelection() {
    const option = selected()
    if (option) {
      const key = JSON.stringify(option.value)
      setSelectedValues(key, !selectedValues[key])
    }
  }

  function getSelectedValues(): T[] {
    return flat()
      .filter((opt) => isSelected(opt.value))
      .map((opt) => opt.value)
  }

  const keybind = useKeybind()
  const allKeybinds = createMemo(() => [
    {
      keybind: { name: "space", ctrl: false, meta: false, shift: false, super: false, leader: false },
      title: "toggle",
      disabled: false,
      onTrigger: () => toggleSelection(),
    },
    {
      keybind: { name: "return", ctrl: false, meta: false, shift: false, super: false, leader: false },
      title: "select",
      disabled: false,
      onTrigger: () => props.onSelect?.(getSelectedValues()),
    },
    ...(props.keybind ?? []),
  ])

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) move(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
    if (evt.name === "pageup") move(-10)
    if (evt.name === "pagedown") move(10)

    for (const item of allKeybinds()) {
      if (item.disabled) continue
      if (Keybind.match(item.keybind, keybind.parse(evt))) {
        evt.preventDefault()
        item.onTrigger(selected())
      }
    }
  })

  let scroll: ScrollBoxRenderable
  const ref: DialogMultiSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return filtered()
    },
  }
  props.ref?.(ref)

  const keybinds = createMemo(() => allKeybinds().filter((x) => !x.disabled))

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        {!props.hideSearch ? (
          <box paddingTop={1} paddingBottom={1}>
            <input
              onInput={(e) => {
                batch(() => {
                  setStore("filter", e)
                  props.onFilter?.(e)
                })
              }}
              focusedBackgroundColor={theme.backgroundPanel}
              cursorColor={theme.primary}
              focusedTextColor={theme.textMuted}
              ref={(r) => {
                input = r
                setTimeout(() => input.focus(), 1)
              }}
              placeholder={props.placeholder ?? "Search"}
            />
          </box>
        ) : (
          <box height={0} overflow="hidden" position="absolute" top={-9999}>
            <input
              onInput={() => {}}
              ref={(r) => {
                input = r
                setTimeout(() => input.focus(), 1)
              }}
            />
          </box>
        )}
      </box>
      <scrollbox
        paddingLeft={1}
        paddingRight={1}
        scrollbarOptions={{ visible: false }}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        maxHeight={height()}
      >
        <For each={grouped()}>
          {([category, options], index) => (
            <>
              <Show when={category}>
                <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={3}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                    {category}
                  </text>
                </box>
              </Show>
              <For each={options}>
                {(option) => {
                  const active = createMemo(() => isDeepEqual(option.value, selected()?.value))
                  const checked = createMemo(() => isSelected(option.value))
                  return (
                    <box
                      id={JSON.stringify(option.value)}
                      flexDirection="row"
                      onMouseUp={() => {
                        const key = JSON.stringify(option.value)
                        setSelectedValues(key, !selectedValues[key])
                      }}
                      onMouseOver={() => {
                        const index = filtered().findIndex((x) => isDeepEqual(x.value, option.value))
                        if (index === -1) return
                        moveTo(index)
                      }}
                      backgroundColor={active() ? (option.bg ?? theme.primary) : RGBA.fromInts(0, 0, 0, 0)}
                      paddingLeft={1}
                      paddingRight={3}
                      gap={1}
                    >
                      <MultiSelectOption
                        title={option.title}
                        footer={option.footer}
                        description={option.description !== category ? option.description : undefined}
                        active={active()}
                        checked={checked()}
                        gutter={option.gutter}
                      />
                    </box>
                  )
                }}
              </For>
            </>
          )}
        </For>
      </scrollbox>
      <Show when={props.beforeFooter || keybinds().length} fallback={<box flexShrink={0} />}>
        <box paddingTop={1}>
          <Show when={props.beforeFooter}>{props.beforeFooter}</Show>
          <Show when={keybinds().length} fallback={<box flexShrink={0} />}>
            <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0}>
              <For each={keybinds()}>
                {(item) => (
                  <text>
                    <span style={{ fg: theme.text }}>
                      <b>{item.title}</b>{" "}
                    </span>
                    <span style={{ fg: theme.textMuted }}>{Keybind.toString(item.keybind)}</span>
                  </text>
                )}
              </For>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function MultiSelectOption(props: {
  title: string
  description?: string
  active?: boolean
  checked?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  return (
    <>
      <text flexShrink={0} fg={props.checked ? (props.active ? fg : theme.primary) : "transparent"} marginRight={0.5}>
        ●
      </text>
      <text
        flexGrow={1}
        fg={props.active ? fg : theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="word"
        paddingLeft={3}
      >
        {Locale.truncate(props.title, 62)}
        <Show when={props.description}>
          <span style={{ fg: props.active ? fg : theme.textMuted }}> {props.description}</span>
        </Show>
      </text>
      <Show when={props.footer}>
        <box flexShrink={0}>
          <text fg={props.active ? fg : theme.textMuted}>{props.footer}</text>
        </box>
      </Show>
    </>
  )
}
