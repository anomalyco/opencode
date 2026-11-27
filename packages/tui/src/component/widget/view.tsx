import {
  InputRenderable,
  TextAttributes,
  type MouseEvent,
  type Renderable,
  type RGBA,
  type TextareaRenderable,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  createComputed,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
  useContext,
  type JSX,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useCursorStyle } from "../../config"
import { Keymap } from "../../context/keymap"
import { useTheme, useThemes } from "../../context/theme"
import type { Node, WidgetEvent } from "@opencode/widget"

export const WIDGET_MODE = "widget"

/** A slider emits its change once keyboard stepping pauses this long. */
const SLIDER_SETTLE = 400
const SLIDER_TRACK = 20

type Item = { key: string; node: Node; children: Item[] }
type Stop = { key: string; node: Node; pager?: string }
type Pager = { key: string; count: number; page: number; id?: string }

type Context = {
  interactive: () => boolean
  background: () => RGBA
  focused: (key: string) => boolean
  paging: (key: string) => boolean
  focus: (key: string) => void
  emit: (event: WidgetEvent) => void
  page: (key: string) => number
  resetPage: (key: string) => void
  turn: (key: string, delta: number) => void
  highlight: (key: string) => number | undefined
  setHighlight: (key: string, index: number) => void
  slider: (key: string) => number | undefined
  setSlider: (key: string, value: number, settle?: boolean) => void
  settle: (key: string) => void
  submitInput: (key: string) => void
  registerInput: (key: string, commit: () => void) => () => void
}

const WidgetContext = createContext<Context>()

/**
 * Renders a widget view tree with native components. Interactive nodes form one focus ring that tab/shift+tab,
 * up/down and the mouse move through; keys only reach it while `active` is true.
 */
export function WidgetView(props: {
  view: Node
  interactive: boolean
  active: boolean
  background: RGBA
  onEvent: (event: WidgetEvent) => void
  onEngage?: () => void
}) {
  const [tree, setTree] = createStore<{ root: Item }>({ root: annotate(props.view, "") })
  createComputed(
    on(
      () => props.view,
      (view) => setTree("root", reconcile(annotate(view, ""), { key: "key" })),
    ),
  )

  const [pages, setPages] = createStore<Record<string, number | undefined>>({})
  const [highlights, setHighlights] = createStore<Record<string, number>>({})
  const [sliders, setSliders] = createStore<Record<string, number | undefined>>({})
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const inputs = new Map<string, () => void>()
  onCleanup(() => timers.forEach((timer) => clearTimeout(timer)))

  const layout = createMemo(() => collect(tree.root, (key, node) => pageOf(key, node)))
  const stops = () => layout().stops
  const pagers = () => layout().pagers

  const [focusKey, setFocusKey] = createSignal<string>()
  const [focusIndex, setFocusIndex] = createSignal(0)
  const current = createMemo(() => {
    const list = stops()
    return list.find((stop) => stop.key === focusKey()) ?? list[Math.min(focusIndex(), list.length - 1)]
  })

  // Leaving a control commits whatever it holds as a draft.
  createEffect(
    on(
      () => (props.active ? current()?.key : undefined),
      (_next, previous) => {
        if (!previous) return
        settle(previous)
        inputs.get(previous)?.()
      },
    ),
  )

  function pageOf(key: string, node: Node) {
    const count = node.type === "carousel" ? node.children.length : 0
    const page = pages[key] ?? (node.type === "carousel" ? node.index : undefined) ?? 0
    return Math.max(0, Math.min(count - 1, page))
  }

  function focus(key: string) {
    const index = stops().findIndex((stop) => stop.key === key)
    if (index === -1) return
    setFocusKey(key)
    setFocusIndex(index)
  }

  function move(delta: number, wrap: boolean) {
    const list = stops()
    if (list.length === 0) return
    const index = Math.max(
      0,
      list.findIndex((stop) => stop.key === current()?.key),
    )
    const next = wrap
      ? (index + delta + list.length) % list.length
      : Math.max(0, Math.min(list.length - 1, index + delta))
    setFocusKey(list[next].key)
    setFocusIndex(next)
  }

  function emit(event: WidgetEvent) {
    if (!props.interactive) return
    props.onEvent(event)
  }

  function turn(key: string, delta: number) {
    const pager = pagers().get(key)
    if (!pager || pager.count < 2) return
    const next = Math.max(0, Math.min(pager.count - 1, pager.page + delta))
    if (next === pager.page) return
    setPages(key, next)
    if (pager.id) emit({ id: pager.id, type: "change", value: next })
  }

  function setSlider(key: string, value: number, now = false) {
    setSliders(key, value)
    clearTimeout(timers.get(key))
    if (now) {
      settle(key)
      return
    }
    timers.set(
      key,
      setTimeout(() => settle(key), SLIDER_SETTLE),
    )
  }

  function settle(key: string) {
    clearTimeout(timers.get(key))
    timers.delete(key)
    const value = sliders[key]
    if (value === undefined) return
    setSliders(key, undefined)
    const node = stops().find((stop) => stop.key === key)?.node
    if (node?.type !== "slider" || node.value === value) return
    emit({ id: node.id, type: "change", value })
  }

  function activate() {
    const stop = current()
    if (!stop) return
    const node = stop.node
    if (node.type === "button" || node.type === "card") {
      if (node.id) emit({ id: node.id, type: "press" })
      return
    }
    if (node.type === "checkbox") {
      emit({ id: node.id, type: "change", value: !node.checked })
      return
    }
    if (node.type === "select") {
      const option = node.options[highlights[stop.key] ?? selectedIndex(node)]
      if (option) emit({ id: node.id, type: "change", value: choose(node, option.value) })
      return
    }
    if (node.type === "slider") settle(stop.key)
  }

  function step(delta: number) {
    const stop = current()
    if (!stop) return false
    const node = stop.node
    if (node.type === "slider") {
      const size = node.step ?? 1
      const value = sliders[stop.key] ?? node.value
      setSlider(stop.key, clamp(round(value + delta * size, size, node.min), node.min, node.max))
      return true
    }
    const pager = stop.pager
    if (!pager) return false
    turn(pager, delta)
    return true
  }

  function vertical(delta: number) {
    const stop = current()
    const node = stop?.node
    if (stop && node?.type === "select") {
      const index = (highlights[stop.key] ?? selectedIndex(node)) + delta
      if (index >= 0 && index < node.options.length) {
        setHighlights(stop.key, index)
        return
      }
    }
    move(delta, false)
  }

  const typing = () => current()?.node.type === "input"

  Keymap.createLayer(() => ({
    mode: WIDGET_MODE,
    enabled: props.active && props.interactive,
    commands: [
      { bind: "tab", title: "Next control", group: "Widget", run: () => move(1, true) },
      { bind: "shift+tab", title: "Previous control", group: "Widget", run: () => move(-1, true) },
      ...(typing()
        ? []
        : [
            { bind: "down", title: "Next control", group: "Widget", run: () => vertical(1) },
            { bind: "up", title: "Previous control", group: "Widget", run: () => vertical(-1) },
            { bind: "left", title: "Decrease or previous page", group: "Widget", run: () => step(-1) },
            { bind: "right", title: "Increase or next page", group: "Widget", run: () => step(1) },
            { bind: "return", title: "Activate control", group: "Widget", run: activate },
            { bind: "space", title: "Activate control", group: "Widget", run: activate },
          ]),
    ],
  }))

  const context: Context = {
    interactive: () => props.interactive,
    background: () => props.background,
    focused: (key) => props.active && props.interactive && current()?.key === key,
    paging: (key) => props.active && props.interactive && current()?.pager === key,
    focus(key) {
      if (!props.interactive) return
      focus(key)
      props.onEngage?.()
    },
    emit,
    page: (key) => pagers().get(key)?.page ?? 0,
    resetPage: (key) => setPages(key, undefined),
    turn,
    highlight: (key) => highlights[key],
    setHighlight: (key, index) => setHighlights(key, index),
    slider: (key) => sliders[key],
    setSlider,
    settle,
    submitInput(key) {
      inputs.get(key)?.()
      move(1, false)
    },
    registerInput(key, commit) {
      inputs.set(key, commit)
      return () => {
        if (inputs.get(key) === commit) inputs.delete(key)
      }
    },
  }

  return (
    <WidgetContext.Provider value={context}>
      <NodeView item={tree.root} />
    </WidgetContext.Provider>
  )
}

function NodeView(props: { item: Item }): JSX.Element {
  const node = () => props.item.node
  return (
    <Switch>
      <Match when={node().type === "column" || node().type === "row" || node().type === "stack"}>
        <Layout item={props.item} />
      </Match>
      <Match when={node().type === "text"}>
        <TextNode item={props.item} />
      </Match>
      <Match when={node().type === "markdown"}>
        <MarkdownNode item={props.item} />
      </Match>
      <Match when={node().type === "image"}>
        <ImageNode item={props.item} />
      </Match>
      <Match when={node().type === "carousel"}>
        <CarouselNode item={props.item} />
      </Match>
      <Match when={node().type === "card"}>
        <CardNode item={props.item} />
      </Match>
      <Match when={node().type === "button"}>
        <ButtonNode item={props.item} />
      </Match>
      <Match when={node().type === "checkbox"}>
        <CheckboxNode item={props.item} />
      </Match>
      <Match when={node().type === "slider"}>
        <SliderNode item={props.item} />
      </Match>
      <Match when={node().type === "select"}>
        <SelectNode item={props.item} />
      </Match>
      <Match when={node().type === "input"}>
        <InputNode item={props.item} />
      </Match>
      <Match when={node().type === "divider"}>
        <DividerNode />
      </Match>
      <Match when={node().type === "table"}>
        <TableNode item={props.item} />
      </Match>
      <Match when={node().type === "canvas"}>
        <SurfaceNode item={props.item} />
      </Match>
    </Switch>
  )
}

function Children(props: { item: Item }) {
  return <For each={props.item.children}>{(child) => <NodeView item={child} />}</For>
}

// A terminal can't layer, so a stack shows its children top to bottom, in order, like a column (widgets.md, Stack).
function Layout(props: { item: Item }) {
  const node = () => props.item.node as Extract<Node, { type: "column" | "row" | "stack" }>
  const row = () => node().type === "row"
  const flow = () => {
    const current = node()
    return current.type === "stack" ? { gap: undefined, align: undefined } : current
  }
  return (
    <box
      flexDirection={row() ? "row" : "column"}
      flexWrap={row() && (node() as Extract<Node, { type: "row" }>).wrap ? "wrap" : "no-wrap"}
      // Gap units are client-relative: one row for gap 1-2 and two for gap 3 vertically, the gap in cells horizontally.
      rowGap={rows(flow().gap)}
      columnGap={row() ? (flow().gap ?? 0) : 0}
      alignItems={align(flow().align ?? (row() ? "start" : "stretch"))}
      flexShrink={0}
    >
      <Children item={props.item} />
    </box>
  )
}

function TextNode(props: { item: Item }) {
  const theme = useTheme()
  const node = () => props.item.node as Extract<Node, { type: "text" }>
  const fg = () => {
    const tone = node().tone
    if (tone === "muted") return theme.text.muted
    if (tone === "success" || tone === "warning" || tone === "error") return theme.text.feedback[tone].base
    if (node().style === "caption") return theme.text.muted
    if (node().style === "code") return theme.markdown.code
    return theme.text.base
  }
  // The theme has no accent text role, so accent and titles carry emphasis with weight instead of a color.
  const bold = () => node().style === "title" || node().tone === "accent"
  return (
    <text fg={fg()} attributes={bold() ? TextAttributes.BOLD : undefined} wrapMode="word" flexShrink={1}>
      {node().text}
    </text>
  )
}

function MarkdownNode(props: { item: Item }) {
  const theme = useTheme()
  const themes = useThemes()
  const context = useWidget()
  const node = () => props.item.node as Extract<Node, { type: "markdown" }>
  return (
    <markdown
      syntaxStyle={themes.currentSyntax()}
      content={node().text}
      conceal={true}
      tableOptions={{ style: "grid", cellPaddingX: 1 }}
      fg={theme.markdown.text}
      bg={context.background()}
    />
  )
}

function ImageNode(props: { item: Item }) {
  const theme = useTheme()
  const node = () => props.item.node as Extract<Node, { type: "image" }>
  const source = () => {
    const src = node().src
    if (src.startsWith("data:")) return src.slice(0, src.indexOf(",") === -1 ? 24 : Math.min(src.indexOf(","), 40))
    return src
  }
  const label = () => node().alt || src(node().src)
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme.text.base} wrapMode="word">
        ▣ {label()}
      </text>
      <text fg={theme.text.muted} wrapMode="char">
        {source()}
      </text>
    </box>
  )
}

// The terminal draws no canvases, 2D or GPU: it shows their alt text, and a poster's source like an image.
function SurfaceNode(props: { item: Item }) {
  const theme = useTheme()
  const node = () => props.item.node as Extract<Node, { type: "canvas" }>
  const poster = () => node().poster
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme.text.base} wrapMode="word">
        ◈ {node().alt || "Canvas"}
      </text>
      <Show when={poster()}>
        {(value) => (
          <text fg={theme.text.muted} wrapMode="char">
            {src(value())}
          </text>
        )}
      </Show>
    </box>
  )
}

function CarouselNode(props: { item: Item }) {
  const theme = useTheme()
  const context = useWidget()
  const renderer = useRenderer()
  const count = () => props.item.children.length
  const page = () => context.page(props.item.key)
  // A program that moves `index` itself takes over from local paging.
  createEffect(
    on(
      () => (props.item.node as Extract<Node, { type: "carousel" }>).index,
      () => context.resetPage(props.item.key),
      { defer: true },
    ),
  )
  const focused = () => context.paging(props.item.key)
  const fg = (active: boolean) => (active ? theme.text.formfield.focused : theme.text.muted)
  const turn = (delta: number) => (event: MouseEvent) => {
    if (renderer.getSelection()?.getSelectedText()) return
    event.stopPropagation()
    context.turn(props.item.key, delta)
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={props.item.children[page()]} keyed>
        {(child) => <NodeView item={child} />}
      </Show>
      <Show when={count() > 1}>
        <box flexDirection="row" gap={1}>
          <text fg={fg(focused() && page() > 0)} onMouseUp={turn(-1)}>
            ‹
          </text>
          <text fg={theme.text.formfield.base} wrapMode="none">
            <Index each={Array.from({ length: count() })}>
              {(_, index) => (
                <span style={{ fg: index === page() ? theme.text.formfield.selected : theme.text.faint }}>
                  {index === page() ? "●" : "○"}
                </span>
              )}
            </Index>
          </text>
          <text fg={fg(focused() && page() < count() - 1)} onMouseUp={turn(1)}>
            ›
          </text>
          <text fg={theme.text.muted}>
            {page() + 1}/{count()}
          </text>
        </box>
      </Show>
    </box>
  )
}

function CardNode(props: { item: Item }) {
  const theme = useTheme()
  const context = useWidget()
  const renderer = useRenderer()
  const node = () => props.item.node as Extract<Node, { type: "card" }>
  const focused = () => context.focused(props.item.key)
  const selected = () => node().selected === true
  const press = () => {
    if (renderer.getSelection()?.getSelectedText()) return
    const id = node().id
    if (!id || !context.interactive()) return
    context.focus(props.item.key)
    context.emit({ id, type: "press" })
  }
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minWidth={22}
      border={true}
      borderStyle="rounded"
      borderColor={
        focused() || selected()
          ? theme.text.formfield.state({ focused: focused(), selected: selected() })
          : theme.border.base
      }
      title={selected() ? " ✓ " : undefined}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={press}
    >
      <Children item={props.item} />
    </box>
  )
}

function ButtonNode(props: { item: Item }) {
  const theme = useTheme()
  const context = useWidget()
  const renderer = useRenderer()
  const node = () => props.item.node as Extract<Node, { type: "button" }>
  const variant = () => {
    const value = node().variant
    if (value === "danger") return "destructive"
    return value ?? "secondary"
  }
  const states = () => ({
    disabled: node().disabled === true || !context.interactive(),
    focused: context.focused(props.item.key),
  })
  return (
    <box
      flexShrink={0}
      alignSelf="flex-start"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.background.action[variant()].state(states())}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (states().disabled) return
        context.focus(props.item.key)
        context.emit({ id: node().id, type: "press" })
      }}
    >
      {/* Some themes give an action variant no focused colors, so focus is also drawn with weight and underline. */}
      <text
        fg={theme.text.action[variant()].state(states())}
        attributes={states().focused ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined}
        wrapMode="none"
      >
        {node().label}
      </text>
    </box>
  )
}

function CheckboxNode(props: { item: Item }) {
  const theme = useTheme()
  const context = useWidget()
  const renderer = useRenderer()
  const node = () => props.item.node as Extract<Node, { type: "checkbox" }>
  const disabled = () => node().disabled === true || !context.interactive()
  const focused = () => context.focused(props.item.key)
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (disabled()) return
        context.focus(props.item.key)
        context.emit({ id: node().id, type: "change", value: !node().checked })
      }}
    >
      <text
        width={4}
        flexShrink={0}
        fg={theme.text.formfield.state({ disabled: disabled(), focused: focused(), selected: node().checked })}
      >
        [{node().checked ? "✓" : " "}]
      </text>
      <text fg={theme.text.formfield.state({ disabled: disabled(), focused: focused() })} wrapMode="word">
        {node().label}
      </text>
    </box>
  )
}

function SliderNode(props: { item: Item }) {
  const theme = useTheme()
  const context = useWidget()
  const node = () => props.item.node as Extract<Node, { type: "slider" }>
  const focused = () => context.focused(props.item.key)
  const value = () => context.slider(props.item.key) ?? node().value
  const ratio = () => {
    const range = node().max - node().min
    return range <= 0 ? 0 : clamp((value() - node().min) / range, 0, 1)
  }
  const knob = () => Math.round(ratio() * (SLIDER_TRACK - 1))
  let track: Renderable | undefined
  const pick = (event: MouseEvent, settle: boolean) => {
    if (!context.interactive() || !track) return
    const size = node().step ?? 1
    const position = clamp((event.x - track.x) / (SLIDER_TRACK - 1), 0, 1)
    const next = round(node().min + position * (node().max - node().min), size, node().min)
    context.focus(props.item.key)
    context.setSlider(props.item.key, clamp(next, node().min, node().max), settle)
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={node().label}>
        <text fg={theme.text.formfield.state({ focused: focused() })}>{node().label}</text>
      </Show>
      <box flexDirection="row" gap={1}>
        <text fg={focused() ? theme.text.formfield.focused : theme.text.faint}>‹</text>
        <text
          ref={(renderable) => (track = renderable)}
          width={SLIDER_TRACK}
          flexShrink={0}
          wrapMode="none"
          onMouseDown={(event) => pick(event, false)}
          onMouseDrag={(event) => pick(event, false)}
          onMouseUp={(event) => pick(event, true)}
        >
          <span style={{ fg: theme.text.formfield.selected }}>{"━".repeat(knob())}</span>
          <span style={{ fg: focused() ? theme.text.formfield.focused : theme.text.formfield.selected }}>●</span>
          <span style={{ fg: theme.text.faint }}>{"─".repeat(SLIDER_TRACK - 1 - knob())}</span>
        </text>
        <text fg={focused() ? theme.text.formfield.focused : theme.text.faint}>›</text>
        <text fg={theme.text.formfield.base} wrapMode="none">
          {format(value())}
        </text>
        <text fg={theme.text.muted} wrapMode="none">
          ({format(node().min)}–{format(node().max)})
        </text>
      </box>
    </box>
  )
}

function SelectNode(props: { item: Item }) {
  const theme = useTheme()
  const context = useWidget()
  const renderer = useRenderer()
  const node = () => props.item.node as Extract<Node, { type: "select" }>
  const focused = () => context.focused(props.item.key)
  const highlight = () => context.highlight(props.item.key) ?? selectedIndex(node())
  const picked = (value: string) => {
    const current = node().value
    return Array.isArray(current) ? current.includes(value) : current === value
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={node().label}>
        <text fg={theme.text.formfield.state({ focused: focused() })}>{node().label}</text>
      </Show>
      <For each={node().options}>
        {(option, index) => {
          const active = () => focused() && highlight() === index()
          return (
            <box
              flexDirection="column"
              onMouseMove={() => context.interactive() && context.setHighlight(props.item.key, index())}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                if (!context.interactive()) return
                context.focus(props.item.key)
                context.setHighlight(props.item.key, index())
                context.emit({ id: node().id, type: "change", value: choose(node(), option.value) })
              }}
            >
              <box flexDirection="row">
                <text
                  width={node().multiple ? 4 : 2}
                  flexShrink={0}
                  fg={theme.text.formfield.state({ focused: active(), selected: picked(option.value) })}
                >
                  {node().multiple ? `[${picked(option.value) ? "✓" : " "}]` : picked(option.value) ? "●" : "○"}
                </text>
                <text fg={theme.text.formfield.state({ focused: active() })} wrapMode="word">
                  {option.label}
                </text>
              </box>
              <Show when={option.description}>
                <box paddingLeft={node().multiple ? 4 : 2}>
                  <text fg={theme.text.muted} wrapMode="word">
                    {option.description}
                  </text>
                </box>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function InputNode(props: { item: Item }) {
  const theme = useTheme()
  const context = useWidget()
  const cursorStyle = useCursorStyle()
  const node = () => props.item.node as Extract<Node, { type: "input" }>
  const focused = () => context.focused(props.item.key)
  const [editor, setEditor] = createSignal<InputRenderable | TextareaRenderable>()
  const initial = node().value
  const text = () => {
    const current = editor()
    if (!current || current.isDestroyed) return node().value
    return current instanceof InputRenderable ? current.value : current.plainText
  }
  const commit = () => {
    const value = text()
    if (value === node().value) return
    context.emit({ id: node().id, type: "change", value })
  }
  onCleanup(context.registerInput(props.item.key, commit))

  // The program owns the value; adopt its updates unless the user is mid-edit.
  createEffect(
    on(
      () => node().value,
      (value) => {
        const current = editor()
        if (!current || current.isDestroyed || current.focused || text() === value) return
        if (current instanceof InputRenderable) current.value = value
        if (!(current instanceof InputRenderable)) current.setText(value)
      },
    ),
  )

  createEffect(() => {
    const current = editor()
    if (!current || current.isDestroyed) return
    if (focused()) {
      current.focusable = true
      if (!current.focused) current.focus()
      return
    }
    if (current.focused) current.blur()
    current.focusable = false
  })

  const colors = () => ({
    backgroundColor: theme.background.formfield.base,
    focusedBackgroundColor: theme.background.formfield.focused,
    textColor: theme.text.formfield.base,
    focusedTextColor: theme.text.formfield.focused,
    cursorColor: theme.text.formfield.focused,
    placeholderColor: theme.text.muted,
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={node().label}>
        <text fg={theme.text.formfield.state({ focused: focused() })}>{node().label}</text>
      </Show>
      <Show
        when={context.interactive()}
        fallback={
          <text fg={node().value ? theme.text.formfield.base : theme.text.muted} wrapMode="word">
            {node().value || node().placeholder || "—"}
          </text>
        }
      >
        <box onMouseDown={() => context.focus(props.item.key)}>
          <Show
            when={node().multiline}
            fallback={
              <input
                ref={setEditor}
                value={initial}
                placeholder={node().placeholder ?? ""}
                cursorStyle={cursorStyle()}
                onSubmit={() => context.submitInput(props.item.key)}
                {...colors()}
              />
            }
          >
            <textarea
              ref={setEditor}
              initialValue={initial}
              placeholder={node().placeholder ?? ""}
              cursorStyle={cursorStyle()}
              minHeight={1}
              maxHeight={6}
              onSubmit={() => context.submitInput(props.item.key)}
              {...colors()}
            />
          </Show>
        </box>
      </Show>
    </box>
  )
}

// A terminal writes a table as aligned text, a line per row (widgets.md, Table): the header in bold with the sort
// indicator, numbers aligned to the end of their column.
function TableNode(props: { item: Item }) {
  const theme = useTheme()
  const node = () => props.item.node as Extract<Node, { type: "table" }>
  const lines = () => {
    const table = node()
    const header = table.columns.map((column, index) =>
      table.sort?.column === index ? column.label + (table.sort.descending ? " ▼" : " ▲") : column.label,
    )
    const rows = table.rows.map((row) => table.columns.map((_, index) => String(row[index] ?? "")))
    const widths = header.map((label, index) => Math.max(label.length, ...rows.map((row) => row[index]!.length)))
    const line = (cells: ReadonlyArray<string>) =>
      cells
        .map((cell, index) =>
          table.columns[index]!.align === "end" ? cell.padStart(widths[index]!) : cell.padEnd(widths[index]!),
        )
        .join("  ")
        .trimEnd()
    return { header: line(header), rows: rows.map(line) }
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
        {lines().header}
      </text>
      <For each={lines().rows}>
        {(row, index) => (
          <text
            fg={index() === node().selected ? theme.text.base : theme.markdown.text}
            attributes={index() === node().selected ? TextAttributes.BOLD : undefined}
            wrapMode="none"
          >
            {row}
          </text>
        )}
      </For>
    </box>
  )
}

function DividerNode() {
  const theme = useTheme()
  return <box height={1} flexShrink={0} border={["top"]} borderStyle="single" borderColor={theme.border.base} />
}

function useWidget() {
  const value = useContext(WidgetContext)
  if (!value) throw new Error("WidgetView context is missing")
  return value
}

function annotate(node: Node, parent: string, index = 0): Item {
  const key = "id" in node && node.id ? `${node.type}#${node.id}` : `${parent}/${index}:${node.type}`
  const children = "children" in node ? node.children.map((child, position) => annotate(child, key, position)) : []
  return { key, node, children }
}

/** Interactive nodes in focus order. A carousel inside a pressable card pages from the card instead of its own stop. */
function collect(root: Item, page: (key: string, node: Node) => number) {
  const stops: Stop[] = []
  const pagers = new Map<string, Pager>()
  const visit = (item: Item, owner?: Stop) => {
    const node = item.node
    if (node.type === "carousel") {
      pagers.set(item.key, { key: item.key, count: item.children.length, page: page(item.key, node), id: node.id })
      if (owner && !owner.pager) owner.pager = item.key
      if (!owner && item.children.length > 1) stops.push({ key: item.key, node, pager: item.key })
      const child = item.children[page(item.key, node)]
      if (child) visit(child, owner)
      return
    }
    if (node.type === "card" && node.id) {
      const stop: Stop = { key: item.key, node }
      stops.push(stop)
      item.children.forEach((child) => visit(child, stop))
      return
    }
    if (node.type === "button" || node.type === "checkbox") {
      if (!node.disabled) stops.push({ key: item.key, node })
      return
    }
    if (node.type === "slider" || node.type === "select" || node.type === "input") {
      stops.push({ key: item.key, node })
      return
    }
    item.children.forEach((child) => visit(child, owner))
  }
  visit(root)
  return { stops, pagers }
}

function selectedIndex(node: Extract<Node, { type: "select" }>) {
  const value = node.value
  const first = Array.isArray(value) ? value[0] : value
  return Math.max(
    0,
    node.options.findIndex((option) => option.value === first),
  )
}

function choose(node: Extract<Node, { type: "select" }>, value: string) {
  if (!node.multiple) return value
  const current = Array.isArray(node.value) ? node.value : node.value ? [node.value] : []
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}

function rows(gap: number | undefined) {
  if (!gap) return 0
  return gap === 3 ? 2 : 1
}

function align(value: "start" | "center" | "end" | "stretch") {
  if (value === "start") return "flex-start"
  if (value === "end") return "flex-end"
  return value
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, step: number, origin: number) {
  const steps = Math.round((value - origin) / step)
  // Trim float noise such as 0.30000000000000004 from fractional steps.
  return Number((origin + steps * step).toPrecision(12))
}

function format(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

function src(value: string) {
  if (value.startsWith("data:")) return "image"
  return value.split(/[?#]/)[0].split("/").filter(Boolean).at(-1) ?? value
}
