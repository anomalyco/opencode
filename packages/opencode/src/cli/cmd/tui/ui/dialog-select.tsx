import {
  InputRenderable,
  RGBA,
  ScrollBoxRenderable,
  TextAttributes,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"
import type { Binding } from "@opentui/keymap"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, For, Show, type JSX, on } from "solid-js"
import { createStore } from "solid-js/store"
import { useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { Locale } from "@/util/locale"
import { getScrollAcceleration } from "../util/scroll"
import { useTuiConfig } from "../context/tui-config"
import { formatKeyBindings, useBindings, useKeymapSelector } from "../keymap"

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  footer?: JSX.Element
  options: DialogSelectOption<T>[]
  flat?: boolean
  ref?: (ref: DialogSelectRef<T>) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  renderFilter?: boolean
  actions?: {
    command: string
    title: string
    side?: "left" | "right"
    disabled?: boolean
    onTrigger: (option: DialogSelectOption<T>) => void
  }[]
  footerHints?: {
    title: string
    label: string
    side?: "left" | "right"
  }[]
  bindings?: readonly Binding<Renderable, KeyEvent>[]
  current?: T
}

export interface DialogSelectOption<T = any> {
  title: string
  titleView?: JSX.Element
  value: T
  description?: string
  details?: string[]
  footer?: JSX.Element | string
  titleWidth?: number
  truncateTitle?: boolean | "left"
  category?: string
  categoryView?: JSX.Element
  disabled?: boolean
  bg?: RGBA
  gutter?: () => JSX.Element
  margin?: JSX.Element
  onSelect?: (ctx: DialogContext) => void
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
  selected: DialogSelectOption<T> | undefined
  moveTo(value: T): void
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse",
  })

  createEffect(
    on(
      () => props.current,
      (current) => {
        if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            setStore("selected", currentIndex)
          }
        }
      },
    ),
  )

  let input: InputRenderable

  const actions = createMemo(() => props.actions ?? [])
  const actionBindings = useKeymapSelector((keymap) =>
    keymap.getCommandBindings({
      visibility: "registered",
      commands: actions().map((item) => item.command),
    }),
  )

  const actionLabels = createMemo(() => {
    const labels = new Map<string, string>()

    for (const action of actions()) {
      const label = formatKeyBindings(actionBindings().get(action.command), tuiConfig)
      if (label) labels.set(action.command, label)
    }

    return labels
  })

  const filtered = createMemo(() => {
    if (props.skipFilter || props.renderFilter === false) return props.options.filter((x) => x.disabled !== true)
    const needle = store.filter.toLowerCase()
    const options = pipe(
      props.options,
      filter((x) => x.disabled !== true),
    )
    if (!needle) return options

    // prioritize title matches (weight: 2) over category matches (weight: 1).
    // users typically search by the item name, and not its category.
    const result = fuzzysort
      .go(needle, options, {
        keys: ["title", "category"],
        scoreFn: (r) => r[0].score * 2 + r[1].score,
      })
      .map((x) => x.obj)

    return result
  })

  // When the filter changes due to how TUI works, the mousemove might still be triggered
  // via a synthetic event as the layout moves underneath the cursor. This is a workaround to make sure the input mode remains keyboard
  // that the mouseover event doesn't trigger when filtering.
  createEffect(() => {
    filtered()
    setStore("input", "keyboard")
  })

  const flatten = createMemo(() => props.flat && store.filter.length > 0)

  const grouped = createMemo<[string, DialogSelectOption<T>[]][]>(() => {
    if (flatten()) return [["", filtered()]]
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

  const rows = createMemo(() => {
    const headers = grouped().reduce((acc, [category], i) => {
      if (!category) return acc
      return acc + (i > 0 ? 2 : 1)
    }, 0)
    return flat().reduce((acc, option) => acc + 1 + (option.details?.length ?? 0), headers)
  })

  const dimensions = useTerminalDimensions()
  const height = createMemo(() => Math.min(rows(), Math.floor(dimensions().height / 2) - 6))

  const selected = createMemo(() => flat()[store.selected])

  createEffect(
    on([() => store.filter, () => props.current], ([filter, current]) => {
      setTimeout(() => {
        if (filter.length > 0) {
          moveTo(0, true)
        } else if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            moveTo(currentIndex, true)
          }
        }
      }, 0)
    }),
  )

  function move(direction: number) {
    if (flat().length === 0) return
    let next = store.selected + direction
    if (next < 0) next = flat().length - 1
    if (next >= flat().length) next = 0
    moveTo(next, true)
  }

  function moveTo(next: number, center = false) {
    setStore("selected", next)
    const option = selected()
    if (option) props.onMove?.(option)
    if (!scroll) return
    const target = scroll.getChildren().find((child: { id?: string }) => {
      return child.id === JSON.stringify(selected()?.value)
    })
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      const centerOffset = Math.floor(scroll.height / 2)
      scroll.scrollBy(y - centerOffset)
    } else {
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
  }

  function submit() {
    setStore("input", "keyboard")
    const option = selected()
    if (!option) return
    option.onSelect?.(dialog)
    props.onSelect?.(option)
  }

  useBindings(() => {
    const enabledActions = actions().filter((item) => !item.disabled)

    return {
      commands: [
        {
          name: "dialog.select.prev",
          title: "Previous item",
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            move(-1)
          },
        },
        {
          name: "dialog.select.next",
          title: "Next item",
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            move(1)
          },
        },
        {
          name: "dialog.select.page_up",
          title: "Page up",
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            move(-10)
          },
        },
        {
          name: "dialog.select.page_down",
          title: "Page down",
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            move(10)
          },
        },
        {
          name: "dialog.select.home",
          title: "First item",
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            moveTo(0)
          },
        },
        {
          name: "dialog.select.end",
          title: "Last item",
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            moveTo(flat().length - 1)
          },
        },
        {
          name: "dialog.select.submit",
          title: "Select item",
          category: "Dialog",
          run: submit,
        },
        ...enabledActions.map((item) => ({
          name: item.command,
          title: item.title,
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            const option = selected()
            if (!option) return
            item.onTrigger(option)
          },
        })),
      ],
      bindings: [
        ...tuiConfig.keybinds.gather("dialog.select", [
          "dialog.select.prev",
          "dialog.select.next",
          "dialog.select.page_up",
          "dialog.select.page_down",
          "dialog.select.home",
          "dialog.select.end",
          "dialog.select.submit",
        ]),
        ...enabledActions.flatMap((item) => tuiConfig.keybinds.get(item.command)),
        ...(props.bindings ?? []).filter((binding) => {
          if (typeof binding.cmd !== "string") return true
          return enabledActions.some((item) => item.command === binding.cmd)
        }),
      ],
    }
  })

  let scroll: ScrollBoxRenderable | undefined
  const ref: DialogSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return filtered()
    },
    get selected() {
      return selected()
    },
    moveTo(value) {
      const index = flat().findIndex((option) => isDeepEqual(option.value, value))
      if (index >= 0) moveTo(index, true)
    },
  }
  props.ref?.(ref)

  const visibleActions = createMemo(() => [
    ...actions()
      .map((item) => ({ ...item, label: actionLabels().get(item.command) ?? "" }))
      .filter((item) => !item.disabled && item.label),
    ...(props.footerHints ?? []),
  ])
  const left = createMemo(() => visibleActions().filter((item) => item.side !== "right"))
  const right = createMemo(() => visibleActions().filter((item) => item.side === "right"))

  return (
    <box gap={1} paddingBottom={1} flexGrow={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <Show when={props.renderFilter !== false}>
          <box paddingTop={1}>
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
                input.traits = { status: "FILTER" }
                setTimeout(() => {
                  if (!input) return
                  if (input.isDestroyed) return
                  input.focus()
                }, 1)
              }}
              placeholder={props.placeholder ?? "Search"}
              placeholderColor={theme.textMuted}
            />
          </box>
        </Show>
      </box>
      <box flexGrow={1} flexShrink={1}>
        <Show
          when={grouped().length > 0}
          fallback={
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={theme.textMuted}>No results found</text>
            </box>
          }
        >
          <scrollbox
            paddingLeft={1}
            paddingRight={1}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
            ref={(r: ScrollBoxRenderable) => (scroll = r)}
            maxHeight={height()}
          >
            <For each={grouped()}>
              {([category, options], index) => (
                <>
                  <Show when={category}>
                    <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={3}>
                      <Show
                        when={options[0]?.categoryView}
                        fallback={
                          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                            {category}
                          </text>
                        }
                      >
                        {options[0]?.categoryView}
                      </Show>
                    </box>
                  </Show>
                  <For each={options}>
                    {(option) => {
                      const active = createMemo(() => isDeepEqual(option.value, selected()?.value))
                      const current = createMemo(() => isDeepEqual(option.value, props.current))
                      return (
                        <box
                          id={JSON.stringify(option.value)}
                          flexDirection="column"
                          position="relative"
                          onMouseMove={() => {
                            setStore("input", "mouse")
                          }}
                          onMouseUp={() => {
                            option.onSelect?.(dialog)
                            props.onSelect?.(option)
                          }}
                          onMouseOver={() => {
                            if (store.input !== "mouse") return
                            const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                            if (index === -1) return
                            moveTo(index)
                          }}
                          onMouseDown={() => {
                            const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                            if (index === -1) return
                            moveTo(index)
                          }}
                        >
                          <box
                            flexDirection="row"
                            paddingLeft={current() || option.gutter ? 1 : 3}
                            paddingRight={3}
                            gap={1}
                            backgroundColor={active() ? (option.bg ?? theme.primary) : RGBA.fromInts(0, 0, 0, 0)}
                          >
                            <Show when={!current() && option.margin}>
                              <box position="absolute" left={1} flexShrink={0}>
                                {option.margin}
                              </box>
                            </Show>
                            <Option
                              title={option.title}
                              titleView={option.titleView}
                              footer={flatten() ? (option.category ?? option.footer) : option.footer}
                              titleWidth={option.titleWidth}
                              truncateTitle={option.truncateTitle}
                              description={option.description !== category ? option.description : undefined}
                              active={active()}
                              current={current()}
                              gutter={option.gutter}
                            />
                          </box>
                          <For each={option.details}>
                            {(detail) => (
                              <box paddingLeft={3} paddingRight={3}>
                                <text fg={theme.textMuted} wrapMode="none">
                                  {Locale.truncateMiddle(detail, Math.max(1, Math.min(76, dimensions().width - 12)))}
                                </text>
                              </box>
                            )}
                          </For>
                        </box>
                      )
                    }}
                  </For>
                </>
              )}
            </For>
          </scrollbox>
        </Show>
      </box>
      <Show when={props.footer || visibleActions().length} fallback={<box flexShrink={0} />}>
        <box
          paddingRight={2}
          paddingLeft={4}
          flexDirection="row"
          justifyContent="space-between"
          flexShrink={0}
          paddingTop={1}
        >
          <box flexDirection="row" gap={2}>
            {props.footer}
            <For each={left()}>
              {(item) => (
                <text>
                  <span style={{ fg: theme.text }}>
                    <b>{item.title}</b>{" "}
                  </span>
                  <span style={{ fg: theme.textMuted }}>{item.label}</span>
                </text>
              )}
            </For>
          </box>
          <box flexDirection="row" gap={2}>
            <For each={right()}>
              {(item) => (
                <text>
                  <span style={{ fg: theme.text }}>
                    <b>{item.title}</b>{" "}
                  </span>
                  <span style={{ fg: theme.textMuted }}>{item.label}</span>
                </text>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  )
}

function Option(props: {
  title: string
  titleView?: JSX.Element
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  titleWidth?: number
  truncateTitle?: boolean | "left"
  gutter?: () => JSX.Element
  onMouseOver?: () => void
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  return (
    <>
      <Show when={props.current}>
        <text flexShrink={0} fg={props.active ? fg : props.current ? theme.primary : theme.text} marginRight={0}>
          ●
        </text>
      </Show>
      <Show when={props.gutter}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter?.()}
        </box>
      </Show>
      <text
        flexGrow={1}
        fg={props.active ? fg : props.current ? theme.primary : theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
        paddingLeft={3}
      >
        {props.titleView ??
          (props.truncateTitle === false
            ? props.title
            : props.truncateTitle === "left"
              ? Locale.truncateLeft(props.title, props.titleWidth ?? 61)
              : Locale.truncate(props.title, props.titleWidth ?? 61))}
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
