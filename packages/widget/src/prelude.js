const __widget_protocol = 2
// Widget prelude (specs/v2/widgets.md): a program is this, a newline, (live: prelude-live.js and a newline,) the source.
// The first line is the prelude<->host contract's version, which hosts read before running the program. Hosts
// (specs/v2/widgets.md, Native hosts) run `<program>\nreturn __widget_native_step(__input())` with `__input` and
// `__widget_emit` as host globals, and live programs with `__widget_live(__input(), true)`: they build the tree clients
// get themselves, so the prelude hands them views as built and finds handlers by their ids' paths.

const ui = (() => {
  // Children may nest arrays and contain null, undefined or false, so widget templates can write `cond && node` and `...list`;
  // the host flattens them when it turns the view into the tree clients get.
  const container = (type) => (props, nodes) =>
    Array.isArray(props) ? { type, children: props } : { ...props, type, children: nodes ?? [] }
  const option = (item) => (typeof item === "string" ? { value: item, label: item } : item)
  const column = (item) => (typeof item === "string" ? { label: item } : item)
  return {
    column: container("column"),
    row: container("row"),
    carousel: container("carousel"),
    card: container("card"),
    stack: container("stack"),
    text: (text, props) => ({ ...props, type: "text", text: String(text) }),
    markdown: (text) => ({ type: "markdown", text: String(text) }),
    image: (src, props) => ({ ...props, type: "image", src }),
    button: (label, props) => ({ ...props, type: "button", label: String(label) }),
    checkbox: (label, checked, props) => ({
      ...props,
      type: "checkbox",
      label: String(label),
      checked: checked === true,
    }),
    slider: (props) => ({ ...props, type: "slider" }),
    select: (options, props) => ({ ...props, type: "select", options: (options ?? []).map(option) }),
    input: (value, props) => ({ ...props, type: "input", value: value ?? "" }),
    divider: () => ({ type: "divider" }),
    table: (columns, rows, props) => ({
      ...props,
      type: "table",
      columns: (columns ?? []).map(column),
      rows: rows ?? [],
    }),
    canvas: (props) => ({ ...props, type: "canvas" }),
    draw: () => new __WidgetDraw(),
  }
})()

// Interactive nodes: the event clients send for them and the handler prop that takes it.
const __WIDGET_CONTROLS = {
  button: { event: "press", handler: "onPress" },
  card: { event: "press", handler: "onPress" },
  checkbox: { event: "change", handler: "onChange" },
  slider: { event: "change", handler: "onChange" },
  select: { event: "change", handler: "onChange" },
  input: { event: "change", handler: "onChange" },
  carousel: { event: "change", handler: "onChange" },
  canvas: { event: "pointer", handler: "onPointer" },
  // A table takes two: a row's press, and a header's press as `change`.
  table: [
    { event: "press", handler: "onPress" },
    { event: "change", handler: "onSort" },
  ],
}

// A view nests at most 100 levels (specs/v2/widgets.md, Keys and depth): the root is level 1, the items of a node's
// children one level below it, and the items of an array among them one level below that array.
const __WIDGET_LEVELS = 100
const __WIDGET_DEEP = "The view nests more than 100 levels"

// Whether `list`, the items at `level`, holds a node or an array below the last level. It runs only for a view that
// failed to cross to the host, and goes no deeper than that level.
function __widget_deep(list, level) {
  for (let index = 0; index < list.length; index++) {
    const item = list[index]
    if (!item || typeof item !== "object") continue
    if (level > __WIDGET_LEVELS) return true
    if (
      Array.isArray(item)
        ? __widget_deep(item, level + 1)
        : item.children !== undefined && __widget_deep(__widget_list(item.children), level + 1)
    )
      return true
  }
  return false
}

// The handler of the node with id `id` in the view `root` as built, found by following the id's path (the host assigns
// the ids, specs/v2/widgets.md, Native hosts). Where two siblings share a segment (a key that looks like a repeat,
// `k~2`), the later one's subtree wins.
function __widget_find(root, id, type) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return undefined
  const segments = String(id).split("/")
  const named = root.key !== undefined && root.key !== null
  if (segments[0] !== (named ? ":" + encodeURIComponent(String(root.key)) : "0")) return undefined
  return __widget_found(root, segments, 1, type)
}

function __widget_found(node, segments, at, type) {
  if (at === segments.length) {
    const controls = __WIDGET_CONTROLS[node.type]
    const control = Array.isArray(controls) ? controls.find((each) => each.event === type) : controls
    const handler = control ? node[control.handler] : undefined
    if (typeof handler !== "function") return undefined
    if (node.type !== "carousel" || node.children === undefined) return { event: control.event, handler, node }
    // A carousel's change is checked against its pages: its children as flattened.
    return {
      event: control.event,
      handler,
      node: { ...node, children: __widget_items(__widget_list(node.children), []) },
    }
  }
  if (node.children === undefined) return undefined
  const matches = []
  __widget_segments(__widget_list(node.children), "", segments[at], matches, null)
  for (let index = matches.length - 1; index >= 0; index--) {
    const found = __widget_found(matches[index], segments, at + 1, type)
    if (found) return found
  }
  return undefined
}

function __widget_list(children) {
  return Array.isArray(children) ? children : [children]
}

function __widget_items(list, into) {
  for (let index = 0; index < list.length; index++) {
    const child = list[index]
    if (Array.isArray(child)) __widget_items(child, into)
    else if (child) into.push(child)
  }
  return into
}

// Pushes onto `into` the children in `list` whose path segment is `segment`, numbering them as hosts do.
function __widget_segments(list, prefix, segment, into, seen) {
  for (let index = 0; index < list.length; index++) {
    const child = list[index]
    if (!child || typeof child !== "object") continue
    if (Array.isArray(child)) {
      seen = __widget_segments(child, prefix + index + ".", segment, into, seen)
      continue
    }
    let next
    if (child.key !== undefined && child.key !== null) {
      next = ":" + encodeURIComponent(String(child.key))
      if (seen === null) seen = new Map()
      const count = (seen.get(next) ?? 0) + 1
      seen.set(next, count)
      if (count > 1) next = next + "~" + count
    } else next = prefix + index
    if (next === segment) into.push(child)
  }
  return seen
}

// The value a handler gets for a client event, checked against the node; undefined drops the event.
function __widget_value(entry, value) {
  const node = entry.node
  if (node.type === "table") {
    const count = (entry.event === "press" ? node.rows : node.columns)?.length ?? 0
    return Number.isInteger(value) && value >= 0 && value < count ? value : undefined
  }
  if (entry.event === "press") return true
  if (entry.event === "pointer") return __widget_pointer(value)
  if (node.type === "checkbox") return typeof value === "boolean" ? value : undefined
  if (node.type === "input") return typeof value === "string" ? value : undefined
  if (node.type === "slider") {
    const number = Number(value)
    if (typeof value !== "number" || !Number.isFinite(number)) return undefined
    return Math.min(node.max ?? number, Math.max(node.min ?? number, number))
  }
  if (node.type === "carousel") {
    const index = Number(value)
    return Number.isInteger(index) && index >= 0 && index < node.children.length ? index : undefined
  }
  if (node.type === "select") {
    const known = (node.options ?? []).map((option) => option.value)
    if (node.multiple) return Array.isArray(value) ? value.filter((item) => known.includes(item)) : undefined
    return known.includes(value) ? value : undefined
  }
  return undefined
}

// The full-screen close button's area a client reports (widgets-fullscreen.md), or null.
function __widget_rect(value) {
  if (!value || typeof value !== "object") return null
  const fields = [value.x, value.y, value.width, value.height]
  if (!fields.every((field) => typeof field === "number" && Number.isFinite(field))) return null
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

// A pointer event's value: absolute `{ kind, x, y, width, height, close? }`, or `{ kind, dx, dy, button }` under
// capture; a wheel's `{ kind, x, y, dx, dy }`, or `{ kind, dx, dy }` under capture. `close` is the full-screen close
// button's area in the node's coordinates, when it overlaps the node.
function __widget_pointer(value) {
  if (!value || typeof value !== "object" || !["down", "move", "up", "wheel"].includes(value.kind)) return undefined
  const number = (field) => (typeof field === "number" && Number.isFinite(field) ? field : 0)
  if (value.kind === "wheel") {
    const at = typeof value.x === "number" ? { x: number(value.x), y: number(value.y) } : {}
    return { kind: "wheel", ...at, dx: number(value.dx), dy: number(value.dy) }
  }
  if (typeof value.x !== "number" && (typeof value.dx === "number" || typeof value.button === "number"))
    return { kind: value.kind, dx: number(value.dx), dy: number(value.dy), button: number(value.button) }
  const close = __widget_rect(value.close)
  return {
    kind: value.kind,
    x: number(value.x),
    y: number(value.y),
    width: number(value.width),
    height: number(value.height),
    ...(close ? { close } : {}),
  }
}

function __widget_key(value) {
  if (!value || typeof value !== "object" || (value.kind !== "down" && value.kind !== "up")) return undefined
  return {
    kind: value.kind,
    key: String(value.key ?? ""),
    code: String(value.code ?? ""),
    repeat: value.repeat === true,
    shift: value.shift === true,
    alt: value.alt === true,
    ctrl: value.ctrl === true,
    meta: value.meta === true,
  }
}

// Draw command builder for `draw(state, data, frame)`. It runs every frame, so it only pushes compact arrays. A paint
// may be a color string: the fill of a shape, the stroke of a line. No paint draws in the "text" color.
class __WidgetDraw {
  constructor() {
    this.commands = []
  }
  save() {
    this.commands.push(["save"])
    return this
  }
  restore() {
    this.commands.push(["restore"])
    return this
  }
  translate(x, y) {
    this.commands.push(["translate", x, y])
    return this
  }
  rotate(radians) {
    this.commands.push(["rotate", radians])
    return this
  }
  scale(sx, sy) {
    this.commands.push(["scale", sx, sy ?? sx])
    return this
  }
  alpha(a) {
    this.commands.push(["alpha", a])
    return this
  }
  rect(x, y, w, h, paint) {
    this.commands.push(["rect", x, y, w, h, __widget_fill(paint)])
    return this
  }
  rrect(x, y, w, h, r, paint) {
    this.commands.push(["rrect", x, y, w, h, r, __widget_fill(paint)])
    return this
  }
  circle(cx, cy, r, paint) {
    this.commands.push(["circle", cx, cy, r, __widget_fill(paint)])
    return this
  }
  line(x1, y1, x2, y2, paint) {
    this.commands.push([
      "line",
      x1,
      y1,
      x2,
      y2,
      paint && typeof paint === "object" ? paint : { stroke: paint || "text" },
    ])
    return this
  }
  path(segments, paint) {
    this.commands.push(["path", segments, __widget_fill(paint)])
    return this
  }
  text(x, y, text, style) {
    this.commands.push(["text", x, y, String(text), style ?? {}])
    return this
  }
  image(src, x, y, w, h) {
    this.commands.push(["image", src, x, y, w, h])
    return this
  }
}

function __widget_fill(paint) {
  return paint && typeof paint === "object" ? paint : { fill: paint || "text" }
}

class __WidgetResult {
  constructor(kind, value, state) {
    this.kind = kind
    this.value = value
    this.state = state
  }
}

// What a step handler or hook may return instead of the next state. Each keeps the current state; `send` may set one.
function submit(value) {
  return new __WidgetResult("submit", value ?? null, undefined)
}

function dismiss() {
  return new __WidgetResult("dismiss", undefined, undefined)
}

// Sends a message to the agent without closing the widget; `wake: false` lets the agent see it only on its next turn.
function send(value, options) {
  return new __WidgetResult("send", { value: value ?? null, wake: options?.wake !== false }, options?.state)
}

// One step (specs/v2/widgets.md, Native hosts): the view goes to `__widget_emit` as built, and the run's result is the
// rest of the step output (`state`, `submit`, `dismiss`, `send`); a draw's commands go to `__widget_emit` too, and
// the run has no result. A view the host can't take because it nests too deep goes as `__widget_emit(null, message)`.
function __widget_native_step(input) {
  const data = input.data
  if (input.phase === "draw") {
    const { id, ...frame } = input.frame ?? {}
    const last = typeof id === "string" ? id.slice(id.lastIndexOf("/") + 1) : ""
    frame.key = last.startsWith(":") ? decodeURIComponent(last.slice(1).replace(/~\d+$/, "")) : null
    const drawn = typeof draw === "function" ? draw(input.state, data, frame) : undefined
    __widget_emit((drawn instanceof __WidgetDraw ? drawn.commands : drawn) ?? [])
    return
  }
  const output = {}
  if (input.phase === "init") output.state = (typeof init === "function" ? init(data) : undefined) ?? {}
  else {
    const next = __widget_dispatch(input.state, input.event ?? {}, data)
    const result = next instanceof __WidgetResult ? next : undefined
    output.state = result
      ? result.state === undefined
        ? input.state
        : result.state
      : next === undefined
        ? input.state
        : next
    if (result?.kind === "dismiss") output.dismiss = true
    if (result?.kind === "send") output.send = result.value
    if (result?.kind === "submit") output.submit = result.value
  }
  const root = view(output.state, data)
  try {
    __widget_emit(root)
  } catch (error) {
    if (!__widget_deep([root], 1)) throw error
    __widget_emit(null, __WIDGET_DEEP)
  }
  return output
}

// Routes one client event: system events to the widget template's hooks, control events to the handler of the node with
// that id in the view of the current state. Nothing else sees either; an event nobody takes changes nothing.
function __widget_dispatch(state, event, data) {
  if (event.type === "key") {
    const key = __widget_key(event.value)
    return key && typeof onKey === "function" ? onKey(state, key) : undefined
  }
  if (event.type === "focus") return typeof onFocus === "function" ? onFocus(state, event.value === true) : undefined
  if (event.type === "fullscreen")
    return typeof onFullscreen === "function"
      ? onFullscreen(state, event.value === true, __widget_rect(event.close))
      : undefined
  if (event.type === "capture")
    return typeof onCapture === "function" ? onCapture(state, event.value === true) : undefined
  if (event.type !== "press" && event.type !== "change" && event.type !== "pointer") return undefined
  const entry = __widget_find(view(state, data), event.id, event.type)
  if (!entry || entry.event !== event.type) return undefined
  const value = __widget_value(entry, event.value)
  if (value === undefined) return undefined
  return event.type === "press" && entry.node.type !== "table" ? entry.handler(state) : entry.handler(state, value)
}
