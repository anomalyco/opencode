// The V2 compatibility layer's renderer (P8): what `@opentui/solid` gives a plugin, over Solid's universal renderer, on
// a tree of plain nodes instead of OpenTUI renderables. A mount's tree is read into a contract 2.0 node
// (`serialize`) each time the JS host views it; any change to it asks for a view.
//
// It keeps what OpenTUI's reconciler does with a plugin's JSX: the same intrinsics, the same props, text only inside a
// `<text>`, and a span's `style` and `href` its only props. An intrinsic the contract has no node for throws as it is
// created, so the plugin's boundary reports it as TS reports a crash in a render.
import { createRenderer } from "solid-js/universal"
import { catchError, createComponent, createContext, createMemo, createRenderEffect, useContext } from "solid-js"
import { createTextAttributes, RGBA, TextAttributes } from "./core"

const SPANS = new Set(["span", "b", "strong", "i", "em", "u", "a", "br"])
const ELEMENTS = new Set(["box", "text", "scrollbox", "markdown", "code", "input", "textarea", ...SPANS])
// The intrinsics of OpenTUI's catalogue the contract has no node for.
const UNSUPPORTED = new Set(["select", "tab_select", "ascii_font", "diff", "line_number", "image", "video"])

export class VNode {
  parent?: VNode
  children: VNode[] = []
  props: Record<string, any> = {}
  // A chunk of text, for a text node.
  text?: string
  // The mount a root node belongs to, which a change of its tree asks to view again.
  owner?: { invalidate(): void }
  // A pointer handler's name in its mount, given as the tree is read.
  constructor(public tag: string) {}

  requestRender() {
    touch(this)
  }

  getChildren() {
    return [...this.children]
  }

  // OpenTUI's renderables take the props a plugin assigns to a ref as their own.
  add(child: VNode, index?: number) {
    insertNode(this, child, index === undefined ? undefined : this.children[index])
  }
}

// The props a plugin may assign to a ref, as on an OpenTUI renderable: each asks for a view.
for (const name of [
  "fg",
  "bg",
  "backgroundColor",
  "content",
  "visible",
  "width",
  "height",
  "attributes",
  "borderColor",
  "title",
  "wrapMode",
  "truncate",
]) {
  Object.defineProperty(VNode.prototype, name, {
    get(this: VNode) {
      return this.props[name]
    },
    set(this: VNode, value: unknown) {
      if (this.props[name] === value) return
      this.props[name] = value
      touch(this)
    },
  })
}

function touch(node: VNode) {
  let at: VNode | undefined = node
  while (at?.parent) at = at.parent
  at?.owner?.invalidate()
}

function textual(node: VNode) {
  return node.tag === "#text" || SPANS.has(node.tag)
}

function insertNode(parent: VNode, node: VNode, anchor?: VNode) {
  // An empty text node is Solid's marker, which stands anywhere.
  if (textual(node) && !(node.tag === "#text" && node.text === "") && !(parent.tag === "text" || SPANS.has(parent.tag)))
    throw new Error(`Orphan text error: "${plain(node)}" must have a <text> as a parent`)
  if (node.parent) remove(node.parent, node)
  const index = anchor ? parent.children.indexOf(anchor) : -1
  if (index === -1) parent.children.push(node)
  else parent.children.splice(index, 0, node)
  node.parent = parent
  touch(parent)
}

function remove(parent: VNode, node: VNode) {
  const index = parent.children.indexOf(node)
  if (index !== -1) parent.children.splice(index, 1)
  node.parent = undefined
  touch(parent)
}

function plain(node: VNode): string {
  return node.tag === "#text" ? (node.text ?? "") : node.children.map(plain).join("")
}

const renderer = createRenderer<VNode>({
  createElement(tag) {
    if (UNSUPPORTED.has(tag)) throw new Error(`<${tag}> is not supported by opencode-native's JS host`)
    if (!ELEMENTS.has(tag)) throw new Error(`[Reconciler] Unknown component type: ${tag}`)
    return new VNode(tag)
  },
  createTextNode(value) {
    const node = new VNode("#text")
    node.text = String(value)
    return node
  },
  replaceText(node, value) {
    node.text = value
    touch(node)
  },
  isTextNode(node) {
    return node.tag === "#text"
  },
  setProperty(node, name, value) {
    // OpenTUI's spans take their `style` and `href` alone; another node takes each prop of a `style` as its own.
    if (SPANS.has(node.tag) && name !== "style" && name !== "href") return
    if (!SPANS.has(node.tag) && name === "style") Object.assign(node.props, value ?? {})
    else node.props[name === "text" ? "content" : name] = value
    touch(node)
  },
  insertNode(parent, node, anchor) {
    insertNode(parent, node, anchor)
  },
  removeNode(parent, node) {
    remove(parent, node)
  },
  getParentNode(node) {
    return node.parent
  },
  getFirstChild(node) {
    return node.children[0]
  },
  getNextSibling(node) {
    const siblings = node.parent?.children ?? []
    return siblings[siblings.indexOf(node) + 1]
  },
})

export const {
  render,
  effect,
  memo,
  createElement,
  createTextNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = renderer
export { createComponent, insertNode }

// What a component's hooks read: the plugin's renderer stand-in and the terminal's size.
export interface Screen {
  width(): number
  height(): number
  renderer: Record<string, unknown>
}

export const ScreenContext = createContext<Screen>()

export function useRenderer() {
  return useContext(ScreenContext)?.renderer ?? {}
}

export function useTerminalDimensions() {
  const screen = useContext(ScreenContext)
  return createMemo(() => ({ width: screen?.width() ?? 0, height: screen?.height() ?? 0 }))
}

export function onResize(callback: (width: number, height: number) => void) {
  const size = useTerminalDimensions()
  createRenderEffect(() => callback(size().width, size().height))
}

// Hooks that need what the JS host does not have: they report it once and do nothing, as a feature TS would run and
// the contract cannot carry.
export const missing = new Set<string>()
function unavailable(name: string) {
  return () => {
    missing.add(name)
  }
}
export const useKeyboard = unavailable("useKeyboard")
export const useKeyHandler = unavailable("useKeyboard")
export const usePaste = unavailable("usePaste")
export const onFocus = unavailable("onFocus")
export const onBlur = unavailable("onBlur")
export const useSelectionHandler = unavailable("useSelectionHandler")
export const onAnimationTick = unavailable("onAnimationTick")
export const useTimeline = () => {
  missing.add("useTimeline")
  return { add() {}, play() {}, pause() {} }
}

// One showing of a JSX render: its root node, the Solid root that owns it, and whether it crashed.
export interface Mounted {
  root: VNode
  dispose(): void
  crashed?: string
}

// Renders `render` under a root node whose changes call `invalidate`; a throw, as it renders or later, ends what it
// shows and calls `crash` once, as TS's plugin boundary does.
export function mount(
  render: () => unknown,
  screen: Screen,
  invalidate: () => void,
  crash: (error: unknown) => void,
): Mounted {
  const root = new VNode("box")
  root.owner = { invalidate }
  let dispose = () => {}
  const mounted: Mounted = { root, dispose: () => dispose() }
  const fail = (error: unknown) => {
    if (mounted.crashed !== undefined) return
    mounted.crashed = error instanceof Error ? error.message : String(error)
    queueMicrotask(() => {
      dispose()
      root.children = []
      invalidate()
    })
    crash(error)
  }
  try {
    dispose = renderer.render(
      () =>
        createComponent(ScreenContext.Provider, {
          value: screen,
          get children() {
            return catchError(render, fail)
          },
        }),
      root,
    )
  } catch (error) {
    fail(error)
  }
  return mounted
}

// What the tree reads into: contract 2.0 nodes, with each color as the host's token when it is the theme's.
type Json = any

export interface Reading {
  // The action a click on `node` runs: a command of the plugin that calls `handler`.
  press(node: VNode, handler: (event: unknown) => unknown): Json
  // What the reader could not carry, by name.
  dropped: Set<string>
}

// A render's nodes are children of the slot's parent in TS, as `<Slot>` is a fragment. The host puts them in the
// mount's own box; when every one is absolute that box is absolute too, and fills the slot's parent, so they sit where
// TS puts them.
export function serialize(root: VNode, reading: Reading): Json {
  const children = nodes(root.children, reading)
  const absolute = children.length > 0 && children.every((child) => child.layout?.absolute)
  return compact({
    type: "box",
    layout: absolute ? { absolute: { top: 0, right: 0, bottom: 0, left: 0 } } : undefined,
    children,
  })
}

function nodes(children: VNode[], reading: Reading): Json[] {
  return children.flatMap((child) => {
    if (child.tag === "#text") {
      if (child.text) throw new Error("rendered bare text; wrap it in <text>")
      return []
    }
    if (child.props.visible === false) return []
    return [node(child, reading)]
  })
}

function node(at: VNode, reading: Reading): Json {
  const props = at.props
  const layout = layoutOf(props, reading)
  const click = clickOf(at, reading)
  switch (at.tag) {
    case "text": {
      const spans = textSpans(at, reading)
      return compact({
        type: "text",
        spans,
        fg: color(props.fg),
        wrap: props.wrapMode === "none" ? "none" : props.wrapMode === "char" ? "char" : undefined,
        truncate: props.truncate ? true : undefined,
        selectable: props.selectable === false ? false : undefined,
        layout,
        on_click: click,
      })
    }
    case "scrollbox":
      return compact({
        type: "scroll",
        follow: props.stickyScroll ? true : undefined,
        layout,
        children: nodes(contentOf(at), reading),
      })
    case "markdown":
      return compact({ type: "markdown", source: { text: String(props.content ?? "") } })
    case "code":
      return compact({
        type: "code",
        content: { text: String(props.content ?? "") },
        filetype: props.filetype,
        layout,
      })
    case "input":
    case "textarea":
      reading.dropped.add(`<${at.tag}> events`)
      return compact({
        type: "input",
        value: String(props.value ?? props.initialValue ?? ""),
        placeholder: props.placeholder,
        lines: at.tag === "textarea" ? Math.max(1, Number(props.height) || 3) : undefined,
        layout,
      })
    default:
      return boxOf(at, layout, click, reading)
  }
}

// A scroll box's children sit in its content box, which a plugin may not wrap.
function contentOf(at: VNode) {
  return at.children
}

function boxOf(at: VNode, layout: Json, click: Json, reading: Reading): Json {
  const props = at.props
  const pad = edges(props, "padding")
  const symmetric = pad && pad.left === pad.right && pad.top === pad.bottom && pad.left >= 0 && pad.top >= 0
  return compact({
    type: "box",
    row: String(props.flexDirection ?? "column").startsWith("row") ? true : undefined,
    gap: number(props.gap ?? (String(props.flexDirection ?? "").startsWith("row") ? props.columnGap : props.rowGap)),
    padding: pad && symmetric ? [pad.left, pad.top] : undefined,
    padding_sides: pad && !symmetric ? pad : undefined,
    justify: justify(props.justifyContent),
    align: align(props.alignItems),
    bg: color(props.backgroundColor),
    layout,
    on_click: click,
    children: nodes(at.children, reading),
    border: borderOf(props),
    wrap: props.flexWrap === "wrap" ? true : undefined,
    overflow: props.overflow === "hidden" || props.overflow === "scroll" ? "hidden" : undefined,
  })
}

function textSpans(at: VNode, reading: Reading) {
  const base = typeof at.props.attributes === "number" ? at.props.attributes : 0
  const spans: Json[] = []
  const walk = (node: VNode, style: Style) => {
    if (node.tag === "#text") {
      if (node.text) spans.push(span(node.text, style))
      return
    }
    if (node.tag === "br") {
      spans.push(span("\n", style))
      return
    }
    for (const child of node.children) walk(child, node === at ? style : inner(node, style))
  }
  walk(at, { attributes: base, bg: at.props.bg })
  if (at.props.content !== undefined && at.children.length === 0)
    spans.push(span(String(at.props.content), { attributes: base, bg: at.props.bg }))
  return spans
}

interface Style {
  attributes: number
  fg?: unknown
  bg?: unknown
  link?: string
}

function inner(node: VNode, outer: Style): Style {
  const style = node.props.style ?? {}
  const own =
    createTextAttributes(style) |
    (node.tag === "b" || node.tag === "strong" ? TextAttributes.BOLD : 0) |
    (node.tag === "i" || node.tag === "em" ? TextAttributes.ITALIC : 0) |
    (node.tag === "u" ? TextAttributes.UNDERLINE : 0)
  return {
    attributes: outer.attributes | own | (typeof style.attributes === "number" ? style.attributes : 0),
    fg: style.fg ?? outer.fg,
    bg: style.bg ?? outer.bg,
    link: node.tag === "a" ? String(node.props.href ?? "") : outer.link,
  }
}

function span(text: string, style: Style) {
  const has = (bit: number) => ((style.attributes & bit) !== 0 ? true : undefined)
  return compact({
    text,
    fg: color(style.fg),
    bg: color(style.bg),
    bold: has(TextAttributes.BOLD),
    italic: has(TextAttributes.ITALIC),
    underline: has(TextAttributes.UNDERLINE),
    dim: has(TextAttributes.DIM),
    strikethrough: has(TextAttributes.STRIKETHROUGH),
    link: style.link || undefined,
  })
}

function clickOf(at: VNode, reading: Reading) {
  const down = at.props.onMouseDown
  const up = at.props.onMouseUp ?? at.props.onClick
  const handler = down ?? up
  if (typeof handler !== "function") return undefined
  return { action: reading.press(at, handler), on: down ? "down" : "up" }
}

function layoutOf(props: Json, reading: Reading) {
  const margin = edges(props, "margin")
  const absolute = props.position === "absolute"
  for (const name of ["maxWidth", "alignSelf", "flexBasis"])
    if (props[name] !== undefined) reading.dropped.add(name)
  if (props.minWidth !== undefined && props.minWidth !== 0) reading.dropped.add("minWidth")
  const layout = compact({
    width: length(props.width),
    grow: Number(props.flexGrow) > 0 ? true : undefined,
    shrink: props.flexShrink === undefined ? undefined : Number(props.flexShrink) > 0,
    min_width_zero: props.minWidth === 0 ? true : undefined,
    height: length(props.height),
    min_height: length(props.minHeight),
    max_height: length(props.maxHeight),
    margin,
    absolute: absolute
      ? compact({
          top: offset(props.top),
          right: offset(props.right),
          bottom: offset(props.bottom),
          left: offset(props.left),
          z: Number(props.zIndex) || undefined,
        })
      : undefined,
  })
  return Object.keys(layout).length ? layout : undefined
}

function edges(props: Json, name: "padding" | "margin") {
  const all = number(props[name]) ?? 0
  const x = number(props[`${name}X`])
  const y = number(props[`${name}Y`])
  const side = (key: string, axis: number | undefined) => number(props[`${name}${key}`]) ?? axis ?? all
  const out = { top: side("Top", y), right: side("Right", x), bottom: side("Bottom", y), left: side("Left", x) }
  return out.top || out.right || out.bottom || out.left ? out : undefined
}

function borderOf(props: Json) {
  const border = props.border
  if (!border && !props.borderStyle && !props.borderColor) return undefined
  if (border === false) return undefined
  const sides = Array.isArray(border)
    ? {
        top: border.includes("top"),
        right: border.includes("right"),
        bottom: border.includes("bottom"),
        left: border.includes("left"),
      }
    : undefined
  return compact({
    sides,
    style: ["double", "rounded", "heavy"].includes(props.borderStyle) ? props.borderStyle : undefined,
    color: color(props.borderColor),
    title: props.title === undefined ? undefined : String(props.title),
    title_align: ["center", "right"].includes(props.titleAlignment) ? props.titleAlignment : undefined,
  })
}

function justify(value: unknown) {
  return (
    { "flex-end": "end", center: "center", "space-between": "space-between", "space-around": "space-around" } as Json
  )[String(value)]
}

function align(value: unknown) {
  return ({ "flex-start": "start", center: "center", "flex-end": "end" } as Json)[String(value)]
}

function length(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return { cells: Math.max(0, Math.round(value)) }
  if (typeof value === "string" && value.endsWith("%")) return { percent: Number(value.slice(0, -1)) }
  return undefined
}

function offset(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined
}

// A color as the host takes it: the theme's token, `#rrggbbaa`, or `#rrggbb` text.
export function color(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (value instanceof RGBA || (typeof value === "object" && "r" in (value as object))) {
    const rgba = value as RGBA
    if (rgba.token) return rgba.token
    const [r, g, b, a] = [rgba.r, rgba.g, rgba.b, rgba.a ?? 1].map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    return `#${r}${g}${b}${a}`
  }
  const text = String(value)
  if (text === "transparent") return "#00000000"
  return text
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
