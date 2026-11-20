// Solid's universal renderer builds a local VNode tree. Serialize the mounted root for each host view; tree
// mutations invalidate the mount.
import { createRenderer } from "solid-js/universal"
import {
  catchError,
  createComponent,
  createContext,
  createMemo,
  createRenderEffect,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  useContext,
  type Owner,
} from "solid-js"
import { createTextAttributes, isStyledText, RGBA, TextAttributes } from "./core"

const SPANS = new Set(["span", "b", "strong", "i", "em", "u", "a", "br"])
const ELEMENTS = new Set(["box", "text", "scrollbox", "markdown", "code", "input", "textarea", "spinner", "select", ...SPANS])
const UNSUPPORTED = new Set(["tab_select", "ascii_font", "diff", "line_number", "image", "video"])
// The props whose setter turns a box's border on (OpenTUI's `initializeBorder`).
const BORDER_ON = new Set(["borderStyle", "borderColor", "focusedBorderColor", "customBorderChars"])
const FOCUSED = new Set(["input", "textarea", "scrollbox"])
const FIELD_EVENTS = new Set(["onInput", "onChange", "onSubmit", "onKeyDown"])

type Listener = (...args: any[]) => unknown

// What a mount does with the focus of its nodes ([`VNode.focus`]).
export interface Focus {
  focus(node: VNode): void
  blur(node: VNode): void
  detached?(node: VNode): void
}

export interface Scrolls {
  state(node: VNode): { offset: number; viewport: number; extent: number } | undefined
  to(node: VNode, offset: number): void
  into?(node: VNode, child: string): void
  rect?(node: VNode): Rect | undefined
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export class VNode {
  parent?: VNode
  children: VNode[] = []
  props: Record<string, any> = {}
  text?: string
  // The mount a root node belongs to, which a change of its tree asks to view again, and which focuses its nodes.
  owner?: { invalidate(): void; focus?: Focus; scrolls?: Scrolls; report?: (feature: string) => void }
  // The Solid owner it was created under, whose mount reports what the plugin asks of it while it is in no mount's
  // tree: a field it removed, or one it never added, has no focus on the host.
  made?: Owner | null
  // Publish focus changes to reactive command predicates.
  #focused = createSignal(false)
  get focused() {
    return this.#focused[0]()
  }
  set focused(focused: boolean) {
    this.#focused[1](focused)
  }
  typed?: string
  // Track the last edit sequence per field so an older render cannot overwrite newer input.
  seen?: Map<string, number>
  // Measured nodes need IDs for host geometry reads.
  measured = false
  // A mount's root: the room the host laid the mount out in, from its input.
  room?: { width: number; height: number }
  private listeners = new Map<string, Listener[]>()
  constructor(public tag: string) {}

  requestRender() {
    touch(this)
  }

  on(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
    return this
  }

  addListener(name: string, listener: Listener) {
    return this.on(name, listener)
  }

  prependListener(name: string, listener: Listener) {
    this.listeners.set(name, [listener, ...(this.listeners.get(name) ?? [])])
    return this
  }

  once(name: string, listener: Listener) {
    const once = (...args: unknown[]) => {
      this.off(name, once)
      return listener(...args)
    }
    return this.on(name, once)
  }

  off(name: string, listener: Listener) {
    const list = this.listeners.get(name) ?? []
    const index = list.indexOf(listener)
    if (index !== -1) this.listeners.set(name, list.toSpliced(index, 1))
    return this
  }

  removeListener(name: string, listener: Listener) {
    return this.off(name, listener)
  }

  removeAllListeners(name?: string) {
    if (name === undefined) this.listeners.clear()
    else this.listeners.delete(name)
    return this
  }

  listenerCount(name: string) {
    return this.listeners.get(name)?.length ?? 0
  }

  emit(name: string, ...args: unknown[]) {
    const list = this.listeners.get(name) ?? []
    for (const listener of list) listener(...args)
    return list.length > 0
  }

  // Fields and scrollboxes delegate focus to the host.
  focus() {
    const root = rootOf(this)
    if (root.owner) return root.owner.focus?.focus(this)
    const report = this.made && runWithOwner(this.made, () => useContext(ReportContext))
    if (FOCUSABLE.has(this.tag)) report?.(`focus() of an <${this.tag}> in no mount`)
  }

  blur() {
    rootOf(this).owner?.focus?.blur(this)
  }

  get scrollTop() {
    return rootOf(this).owner?.scrolls?.state(this)?.offset ?? 0
  }

  get scrollHeight() {
    return rootOf(this).owner?.scrolls?.state(this)?.extent ?? 0
  }

  get viewport() {
    const state = rootOf(this).owner?.scrolls?.state(this)
    return { width: Number(this.props.width) || 0, height: state?.viewport ?? Infinity }
  }

  scrollTo(to: number | { y?: number }) {
    const offset = typeof to === "number" ? to : (to?.y ?? 0)
    // OpenTUI clamps any offset to the content, and plugins scroll to the bottom with `Number.MAX_SAFE_INTEGER`. The
    // host clamps too but reads an i32, so a number past it is the i32's edge.
    rootOf(this).owner?.scrolls?.to(this, Math.max(-(2 ** 31), Math.min(2 ** 31 - 1, Math.round(offset))))
  }

  scrollBy(by: number | { y?: number }) {
    this.scrollTo(this.scrollTop + (typeof by === "number" ? by : (by?.y ?? 0)))
  }

  scrollChildIntoView(id: string) {
    rootOf(this).owner?.scrolls?.into?.(this, id)
  }

  // A field's text, as OpenTUI's `InputRenderable.value`: what was typed in the host's field, else the plugin's.
  get value() {
    return this.typed ?? String(this.props.value ?? this.props.initialValue ?? "")
  }

  set value(value: string) {
    this.typed = undefined
    this.props.value = value
    touch(this)
  }

  // Geometry reads use the last settled host frame.
  measure(): Rect | undefined {
    if (!this.measured) {
      this.measured = true
      touch(this)
    }
    // An unmeasured root can still use the room promised in its mount input.
    const rect = rootOf(this).owner?.scrolls?.rect?.(this)
    if (!rect || (rect.width === 0 && rect.height === 0)) return this.ahead()
    // A fixed width (or height) is what the host lays the node out at, as such a node does not shrink: it answers at
    // once, where the host's rect is of the tree before the plugin set it, a frame late. OpenTUI's layout follows a
    // set size at once, so a plugin that sizes a node from its own size never sees the old one.
    const fixed = (value: unknown, laid: number) => (typeof value === "number" ? value : laid)
    return { ...rect, width: fixed(this.props.width, rect.width), height: fixed(this.props.height, rect.height) }
  }

  // Use mount dimensions before the first layout; nested nodes still need host geometry.
  private ahead(): Rect | undefined {
    const room = this.parent?.room
    if (!room || this.parent?.parent) return undefined
    const width = this.props.width === "100%" ? room.width : typeof this.props.width === "number" ? this.props.width : undefined
    const height = typeof this.props.height === "number" ? this.props.height : 0
    return width === undefined ? undefined : { x: 0, y: 0, width, height }
  }

  getLayout() {
    const rect = this.measure()
    const node = this
    const [x, y, width, height] = [rect?.x ?? 0, rect?.y ?? 0, rect?.width ?? 0, rect?.height ?? 0]
    const parent = () => (node.parent?.parent ? node.parent.measure() : undefined)
    return {
      x,
      y,
      width,
      height,
      get left() {
        return x - (parent()?.x ?? 0)
      },
      get top() {
        return y - (parent()?.y ?? 0)
      },
      get right() {
        return x - (parent()?.x ?? 0) + width
      },
      get bottom() {
        return y - (parent()?.y ?? 0) + height
      },
    }
  }

  // The node gained or lost the focus: it emits as an OpenTUI renderable does.
  focusChanged(focused: boolean) {
    if (this.#focused[0]() === focused) return
    this.#focused[1](focused)
    this.emit(focused ? "focused" : "blurred")
  }

  getChildren() {
    return [...this.children]
  }

  // Plugin-built renderables use the same virtual nodes as JSX.
  add(child: VNode, index?: number) {
    if (!(child instanceof VNode)) return rootOf(this).owner?.report?.("a renderable built with new")
    insertNode(this, child, index === undefined ? undefined : this.children[index])
  }

  insertBefore(child: VNode, anchor?: VNode) {
    if (!(child instanceof VNode)) return rootOf(this).owner?.report?.("a renderable built with new")
    insertNode(this, child, anchor instanceof VNode ? anchor : undefined)
  }

  remove(id: string) {
    const child = this.children.find((node) => node.props.id === id)
    if (child) remove(this, child)
  }
}

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
  "titleAlignment",
  "bottomTitle",
  "bottomTitleAlignment",
  "wrapMode",
  "truncate",
  "flexDirection",
  "flexGrow",
  "flexShrink",
  "alignItems",
  "justifyContent",
  "gap",
  "padding",
  "paddingX",
  "paddingY",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "margin",
  "marginLeft",
  "marginRight",
  "marginTop",
  "marginBottom",
  "border",
  "borderStyle",
  "filetype",
  "placeholder",
]) {
  Object.defineProperty(VNode.prototype, name, {
    // Prefer measured size over the requested layout size.
    get(this: VNode) {
      if (name !== "width" && name !== "height") return this.props[name]
      return this.measure()?.[name] ?? 0
    },
    set(this: VNode, value: unknown) {
      if (this.props[name] === value) return
      this.props[name] = value
      touch(this)
    },
  })
}

const FOCUSABLE = new Set(["input", "textarea", "scrollbox"])

export function rootOf(node: VNode) {
  let at = node
  while (at.parent) at = at.parent
  return at
}

function touch(node: VNode) {
  rootOf(node).owner?.invalidate()
}

function textual(node: VNode) {
  return node.tag === "#text" || SPANS.has(node.tag)
}

function insertNode(parent: VNode, node: VNode, anchor?: VNode) {
  // An empty text node is Solid's marker, which stands anywhere.
  if (textual(node) && !(node.tag === "#text" && node.text === "") && !(parent.tag === "text" || SPANS.has(parent.tag)))
    throw new Error(`Orphan text error: "${plain(node)}" must have a <text> as a parent`)
  // Reject cycles before linking a child.
  for (let at: VNode | undefined = parent; at; at = at.parent)
    if (at === node) throw new Error(`a <${node.tag}> cannot be added inside itself`)
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
    const node = new VNode(tag)
    node.made = getOwner()
    return node
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
    const was = node.props.focused
    // A node other than a span takes each prop of a `style` as its own. A span is read by its `style` and `href` alone
    // (`inner`), as OpenTUI's spans are.
    if (!SPANS.has(node.tag) && name === "style") Object.assign(node.props, value ?? {})
    else node.props[name === "text" ? "content" : name] = value
    touch(node)
    // A field's or a scroll box's `focused` focuses it as it turns true, also as it is created, and blurs it as it turns
    // false, as OpenTUI's does; once it is in its mount, a microtask later (contract 2.x, `focus-input`). A focused
    // scroll box scrolls on the arrows and the page keys (sidebar-prompt's dialog).
    if (name === "focused" && FOCUSED.has(node.tag) && !!value !== !!was)
      queueMicrotask(() => (value ? node.focus() : node.blur()))
  },
  insertNode(parent, node, anchor) {
    if (!(node instanceof VNode)) return rootOf(parent).owner?.report?.("a renderable built with new")
    insertNode(parent, node, anchor instanceof VNode ? anchor : undefined)
  },
  removeNode(parent, node) {
    if (!(node instanceof VNode)) return
    // Solid removes a node here, and moves one with `insertNode`, which keeps its focus.
    rootOf(parent).owner?.focus?.detached?.(node)
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

export interface Screen {
  width(): number
  height(): number
  renderer: Record<string, unknown>
}

export const ScreenContext = createContext<Screen>()
const ReportContext = createContext<((feature: string) => void) | undefined>()

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
// Release events are unavailable on the host keyboard stream.
export function useKeyboard(handler: Listener, options?: { release?: boolean }) {
  const keys = useContext(ScreenContext)?.renderer.keyInput as
    | { on(name: string, listener: Listener): unknown; off(name: string, listener: Listener): unknown }
    | undefined
  if (!keys) {
    missing.add("useKeyboard")
    return
  }
  keys.on("keypress", handler)
  if (options?.release) keys.on("keyrelease", handler)
  onCleanup(() => {
    keys.off("keypress", handler)
    keys.off("keyrelease", handler)
  })
}
export const useKeyHandler = useKeyboard
export const usePaste = unavailable("usePaste")
export const onFocus = unavailable("onFocus")
export const onBlur = unavailable("onBlur")
export const useSelectionHandler = unavailable("useSelectionHandler")
export const onAnimationTick = unavailable("onAnimationTick")
export const useTimeline = () => {
  missing.add("useTimeline")
  return { add() {}, play() {}, pause() {} }
}

export interface Mounted {
  root: VNode
  dispose(): void
  crashed?: string
  // The reads its renders made, which the plugin keeps watching while it lives.
  keys: Set<string>
}

export function mount(
  render: () => unknown,
  screen: Screen,
  invalidate: () => void,
  crash: (error: unknown) => void,
  focus?: Focus,
  scrolls?: Scrolls,
  report?: (feature: string) => void,
): Mounted {
  const root = new VNode("box")
  root.owner = { invalidate, focus, scrolls, report }
  let dispose = () => {}
  const mounted: Mounted = { root, dispose: () => dispose(), keys: new Set() }
  const fail = (error: unknown) => {
    if (mounted.crashed !== undefined) return
    mounted.crashed = error instanceof Error ? error.message : String(error)
    // Discard partially built trees if rendering throws.
    root.children = []
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
            return createComponent(ReportContext.Provider, {
              value: report,
              get children() {
                return catchError(render, fail)
              },
            })
          },
        }),
      root,
    )
  } catch (error) {
    fail(error)
  }
  return mounted
}

type Json = any

export interface Reading {
  press(node: VNode, handler: (event: unknown) => unknown, kind: "down" | "up"): Json
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

// A claim returns one complete tree or declines; unsupported content falls back to the host.
export function claimTree(root: VNode, reading: Reading): Json {
  return root.props.visible === false ? compact({ type: "box", children: [] }) : node(root, reading)
}

const LAYOUT = new Set(["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "flexGrow", "flexShrink", "margin", "marginX", "marginY", "marginLeft", "marginRight", "marginTop", "marginBottom", "position", "top", "right", "bottom", "left", "zIndex"])

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
        id: idOf(at),
        follow: props.stickyScroll ? true : undefined,
        // OpenTUI's scroll box shows its scrollbar while its content overflows, unless the plugin hides it.
        scrollbar: props.scrollbarOptions?.visible === false || props.verticalScrollbarOptions?.visible === false ? undefined : true,
        layout,
        children: nodes(contentOf(at), reading),
      })
    case "markdown":
      return compact({ type: "markdown", source: { text: String(props.content ?? "") } })
    case "fence":
      for (const name of Object.keys(props).filter((name) => name !== "bg" && !LAYOUT.has(name)))
        reading.dropped.add(`a code block's default render ${name}`)
      return compact({ type: "fence", bg: color(props.bg), layout })
    case "spinner":
      for (const name of ["frames", "interval", "color", "backgroundColor", "autoplay"])
        if (props[name] !== undefined) reading.dropped.add(`<spinner> ${name}`)
      return { type: "spinner", label: "" }
    case "select":
      return selectOf(at, layout, click, reading)
    case "code":
      return compact({
        type: "code",
        content: { text: String(props.content ?? "") },
        filetype: props.filetype,
        layout,
      })
    case "input":
    case "textarea":
      for (const name of Object.keys(props).filter((name) => /^on[A-Z]/.test(name) && !FIELD_EVENTS.has(name)))
        if (typeof props[name] === "function") reading.dropped.add(`<${at.tag}> ${name}`)
      return compact({
        type: "input",
        id: idOf(at),
        value: String(props.value ?? props.initialValue ?? ""),
        placeholder: props.placeholder,
        lines: at.tag === "textarea" ? clamp(Number(props.height) || 3, 1, 65535) : undefined,
        layout,
        seen: rootOf(at).seen?.get(idOf(at)),
      })
    default:
      return boxOf(at, layout, click, reading)
  }
}

// Render select options as rows; this intrinsic does not open a host dialog.
const SELECT = {
  backgroundColor: "transparent",
  textColor: "#FFFFFF",
  selectedBackgroundColor: "#334455",
  selectedTextColor: "#FFFF00",
  descriptionColor: "#888888",
  selectedDescriptionColor: "#CCCCCC",
}
function selectOf(at: VNode, layout: Json, click: Json, reading: Reading): Json {
  const props = at.props
  const options: Json[] = Array.isArray(props.options) ? props.options : []
  const pick = (name: keyof typeof SELECT) => color(props[name] ?? SELECT[name])
  const described = props.showDescription !== false
  const indicator = props.showSelectionIndicator !== false
  const lines = (described ? 2 : 1) + (Number(props.itemSpacing) || 0)
  const room = typeof props.height === "number" ? Math.floor(props.height / lines) : options.length
  const selected = clamp(Number(props.selectedIndex) || 0, 0, Math.max(0, options.length - 1))
  const scroll = clamp(selected - room + 1, 0, Math.max(0, options.length - room))
  for (const name of ["onChange", "keyBindings", "font", "showScrollIndicator"])
    if (props[name] !== undefined) reading.dropped.add(`<select> ${name}`)
  const row = (text: string, fg: string | undefined, pad: number) =>
    compact({ type: "text", spans: [{ text }], fg, wrap: "none", layout: { margin: { left: pad, right: 0, top: 0, bottom: 0 } } })
  const children = options.slice(scroll, scroll + room).map((option, index) => {
    const chosen = scroll + index === selected
    const mark = indicator ? (chosen ? "\u25B6 " : "  ") : ""
    return compact({
      type: "box",
      bg: chosen ? pick("selectedBackgroundColor") : undefined,
      children: [
        row(`${mark}${String(option?.name ?? "")}`, pick(chosen ? "selectedTextColor" : "textColor"), 1),
        ...(described ? [row(String(option?.description ?? ""), pick(chosen ? "selectedDescriptionColor" : "descriptionColor"), 1 + (indicator ? 2 : 0))] : []),
      ],
    })
  })
  return compact({ type: "box", id: idOf(at), bg: pick("backgroundColor"), layout, on_click: click, children })
}

// A node whose state the host keeps (a scroll's offset, a field's text) needs an id, stable while the node lives: the
// plugin's own, or one of the layer's.
const ids = new WeakMap<VNode, string>()
let lastId = 0
export function idOf(at: VNode) {
  if (typeof at.props.id === "string" && at.props.id) return at.props.id
  if (!ids.has(at)) ids.set(at, `opentui-${at.tag}-${++lastId}`)
  return ids.get(at)!
}

// A scroll box's children sit in its content box, which a plugin may not wrap.
function contentOf(at: VNode) {
  return at.children
}

function boxOf(at: VNode, layout: Json, click: Json, reading: Reading): Json {
  const props = at.props
  const pad = edges(props, "padding")
  const symmetric = pad && pad.left === pad.right && pad.top === pad.bottom && pad.left >= 0 && pad.top >= 0
  if (typeof (props.onSizeChange ?? (at as unknown as Record<string, unknown>).onSizeChange) === "function") at.measure()
  // The contract's box has no reversed direction, no even spacing and no baseline.
  for (const [name, value] of [
    ["flexDirection", "row-reverse"],
    ["flexDirection", "column-reverse"],
    ["justifyContent", "space-evenly"],
    ["alignItems", "baseline"],
  ])
    if (props[name] === value) reading.dropped.add(`${name} ${value}`)
  return compact({
    type: "box",
    id: at.measured ? idOf(at) : undefined,
    row: String(props.flexDirection ?? "column").startsWith("row") ? true : undefined,
    gap: cells(props.gap ?? (String(props.flexDirection ?? "").startsWith("row") ? props.columnGap : props.rowGap)),
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
  const content = at.props.content
  if (content === undefined || at.children.length > 0) return spans
  if (isStyledText(content))
    for (const chunk of content.chunks) {
      const style = { attributes: base | (chunk.attributes ?? 0), fg: chunk.fg, bg: chunk.bg ?? at.props.bg, link: chunk.link?.url }
      if (chunk.text) spans.push(span(chunk.text, style))
    }
  else spans.push(span(String(content), { attributes: base, bg: at.props.bg }))
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
  // A host node has one click action. Prefer the press handler when both are supplied.
  if (down && up) reading.dropped.add("onMouseUp beside onMouseDown")
  const action = reading.press(at, handler, down ? "down" : "up")
  return action === undefined ? undefined : { action, on: down ? "down" : "up" }
}

function layoutOf(props: Json, reading: Reading) {
  const margin = edges(props, "margin")
  const absolute = props.position === "absolute"
  for (const name of ["alignSelf", "flexBasis"])
    if (props[name] !== undefined) reading.dropped.add(name)
  const layout = compact({
    width: length(props.width),
    grow: Number(props.flexGrow) > 0 ? true : undefined,
    // Fixed sizes opt out of shrink unless the plugin overrides it.
    shrink:
      props.flexShrink !== undefined
        ? Number(props.flexShrink) > 0
        : typeof props.width === "number" || typeof props.height === "number"
          ? false
          : undefined,
    min_width: length(props.minWidth),
    max_width: length(props.maxWidth),
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
          z: Number.isFinite(Number(props.zIndex)) ? clamp(Number(props.zIndex), -2147483648, 2147483647) || undefined : undefined,
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

// Preserve property order: setting a border style or color can enable the border.
function borderOf(props: Json) {
  let border: unknown = false
  for (const name of Object.keys(props)) {
    if (name === "border") border = props.border
    else if (BORDER_ON.has(name) && border === false) border = true
  }
  if (border !== true && !Array.isArray(border)) return undefined
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
    bottom_title: props.bottomTitle === undefined ? undefined : String(props.bottomTitle),
    bottom_title_align: ["center", "right"].includes(props.bottomTitleAlignment) ? props.bottomTitleAlignment : undefined,
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

// Clamp numeric props to the ABI field's range before encoding.
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(value)))

function length(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return { cells: clamp(value, 0, 65535) }
  if (typeof value !== "string" || !value.endsWith("%")) return undefined
  const percent = Number(value.slice(0, -1))
  return Number.isFinite(percent) ? { percent: Math.min(100, Math.max(0, percent)) } : undefined
}

function offset(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, -32768, 32767) : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, -32768, 32767) : undefined
}

function cells(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 65535) : undefined
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
