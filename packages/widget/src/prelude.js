const __widget_protocol = 2
// Widget prelude (specs/v2/widgets.md). A widget program is this prelude, a newline, then the widget template source.
// The first line is the prelude<->host contract's version, which hosts read before running the program. Native hosts
// (specs/v2/widgets.md, Native hosts) run `<program>\nreturn __widget_native_step(__input())` with `__input` and
// `__widget_emit` as host globals, and live programs with `__widget_live(__input(), true)`: they build the tree clients
// get themselves, so the prelude hands them views as built and finds handlers by their ids' paths. Older hosts run
// `return __widget_step(__input())`, and the prelude builds the tree.

const ui = (() => {
  // Children may nest arrays and contain null, undefined or false, so widget templates can write `cond && node` and `...list`;
  // `__widget_tree` flattens them when it turns the view into the tree clients get.
  const container = (type) => (props, nodes) =>
    Array.isArray(props) ? { type, children: props } : { ...props, type, children: nodes ?? [] }
  const option = (item) => (typeof item === "string" ? { value: item, label: item } : item)
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
    canvas: (props) => ({ ...props, type: "canvas" }),
    draw: () => new __WidgetDraw(),
  }
})()

// Interactive nodes: the event clients send for them and the handler prop that takes it. `always`: the node gets an id
// even without a handler (clients require one); `keyed`: a `key` alone gives it an id too (canvases drawn by key).
const __WIDGET_CONTROLS = {
  button: { event: "press", handler: "onPress", always: true },
  card: { event: "press", handler: "onPress" },
  checkbox: { event: "change", handler: "onChange", always: true },
  slider: { event: "change", handler: "onChange", always: true },
  select: { event: "change", handler: "onChange", always: true },
  input: { event: "change", handler: "onChange", always: true },
  carousel: { event: "change", handler: "onChange" },
  canvas: { event: "pointer", handler: "onPointer", keyed: true },
}

// Turns a view as widget templates build it into the tree clients get: children flattened, handler functions and `key`s
// removed, and each interactive node given an id from its path (child indices, or `:key` where the author set a key),
// so the same node keeps its id from one view to the next. Returns the tree, the handlers by id and canvas ids by key.
// It runs for every node of every view, so it copies only the nodes it has to change and builds no closures.
function __widget_tree(root) {
  const tree = { view: undefined, handlers: {}, canvases: {} }
  const named = root && typeof root === "object" && !Array.isArray(root) && __widget_keyed(root.key)
  tree.view = __widget_node(root, named ? ":" + encodeURIComponent(String(root.key)) : "0", tree, 1)
  return tree
}

// A view nests at most 100 levels (specs/v2/widgets.md, Keys and depth): the root is level 1, the items of a node's children one
// level below it, and the items of an array among them one level below that array.
const __WIDGET_LEVELS = 100
const __WIDGET_DEEP = "The view nests more than 100 levels"
const __WIDGET_KEY = "A node's key must be a string, a number or a boolean"

// Whether a node has a key: `undefined` and `null` are none; a string, a number or a boolean is one.
function __widget_keyed(key) {
  if (key === undefined || key === null) return false
  const type = typeof key
  if (type === "string" || type === "number" || type === "boolean") return true
  throw new TypeError(__WIDGET_KEY)
}

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

// A node that goes out as built: not interactive, no container, and none of the props the prelude takes off.
function __widget_plain(node) {
  return (
    node.children === undefined &&
    __WIDGET_CONTROLS[node.type] === undefined &&
    node.key === undefined &&
    node.id === undefined &&
    node.pointer === undefined &&
    node.onPress === undefined &&
    node.onChange === undefined &&
    node.onPointer === undefined
  )
}

function __widget_node(node, path, tree, level) {
  if (!node || typeof node !== "object" || Array.isArray(node) || __widget_plain(node)) return node
  const { key, id, pointer, onPress, onChange, onPointer, children, ...out } = node
  const control = __WIDGET_CONTROLS[node.type]
  if (control) {
    const handler = node[control.handler]
    const keyed = control.keyed && key !== undefined && key !== null
    if (typeof handler === "function" || control.always || keyed) {
      out.id = path
      if (typeof handler === "function") tree.handlers[path] = { event: control.event, handler, node: out }
      // Only a canvas with a handler takes input; one with just a key has an id for `widget.draw`.
      if (node.type === "canvas" && typeof handler === "function") out.pointer = true
      if (keyed && tree.canvases[String(key)] === undefined)
        tree.canvases[String(key)] = { id: path, wgsl: typeof node.wgsl === "string" }
    }
  }
  if (children === undefined) return out
  out.children = []
  __widget_children(Array.isArray(children) ? children : [children], "", path, out.children, tree, null, level + 1)
  return out
}

// Appends `list`'s nodes to `into`, flattening nested arrays (their items' segments are `index.index`) and skipping
// holes, which keep their index. Repeated keys among siblings still get distinct ids, in order (`seen` counts them).
function __widget_children(list, prefix, path, into, tree, seen, level) {
  for (let index = 0; index < list.length; index++) {
    const child = list[index]
    if (!child) continue
    if (level > __WIDGET_LEVELS && typeof child === "object") throw new RangeError(__WIDGET_DEEP)
    if (Array.isArray(child)) {
      seen = __widget_children(child, prefix + index + ".", path, into, tree, seen, level + 1)
      continue
    }
    // Plain leaves (most text) need no path: building one costs more than the leaf itself.
    if (typeof child !== "object" || __widget_plain(child)) {
      into.push(child)
      continue
    }
    let next
    if (__widget_keyed(child.key)) {
      next = path + "/:" + encodeURIComponent(String(child.key))
      if (seen === null) seen = new Map()
      const count = (seen.get(next) ?? 0) + 1
      seen.set(next, count)
      if (count > 1) next = next + "~" + count
    } else next = path + "/" + prefix + index
    into.push(__widget_node(child, next, tree, level))
  }
  return seen
}

// The handler of the node with id `id` in the view `root` as built: what `__widget_tree(root).handlers[id]` would be,
// found by following the id's path instead of building the tree (native hosts assign the ids). Where two siblings
// share a segment (a key that looks like a repeat, `k~2`), the later one's subtree wins, as in the table.
function __widget_find(root, id) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return undefined
  const segments = String(id).split("/")
  const named = root.key !== undefined && root.key !== null
  if (segments[0] !== (named ? ":" + encodeURIComponent(String(root.key)) : "0")) return undefined
  return __widget_found(root, segments, 1)
}

function __widget_found(node, segments, at) {
  if (at === segments.length) {
    const control = __WIDGET_CONTROLS[node.type]
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
    const found = __widget_found(matches[index], segments, at + 1)
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

// Pushes onto `into` the children in `list` whose path segment is `segment`, numbering them as `__widget_children`.
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
// capture. `close` is the full-screen close button's area in the node's coordinates, when it overlaps the node.
function __widget_pointer(value) {
  if (!value || typeof value !== "object" || !["down", "move", "up"].includes(value.kind)) return undefined
  const number = (field) => (typeof field === "number" && Number.isFinite(field) ? field : 0)
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

// A step for a host that builds the tree itself: the view goes to `__widget_emit` as built, and the run's result is the
// rest of the step output (`state`, `submit`, `dismiss`, `send`) or a draw's `{ commands }`. A view the host can't take
// because it nests too deep goes as `__widget_emit(null, message)` instead.
function __widget_native_step(input) {
  const output = __widget_advance(input, true)
  if (input.phase === "draw") return output
  const { view, ...rest } = output
  try {
    __widget_emit(view)
  } catch (error) {
    if (!__widget_deep([view], 1)) throw error
    __widget_emit(null, __WIDGET_DEEP)
  }
  return rest
}

function __widget_step(input) {
  return __widget_advance(input, false)
}

function __widget_advance(input, native) {
  const data = input.data
  if (input.phase === "draw") {
    const { id, ...frame } = input.frame ?? {}
    const last = typeof id === "string" ? id.slice(id.lastIndexOf("/") + 1) : ""
    frame.key = last.startsWith(":") ? decodeURIComponent(last.slice(1).replace(/~\d+$/, "")) : null
    const drawn = typeof draw === "function" ? draw(input.state, data, frame) : undefined
    return { commands: (drawn instanceof __WidgetDraw ? drawn.commands : drawn) ?? [] }
  }
  if (input.phase === "init") {
    const state = (typeof init === "function" ? init(data) : undefined) ?? {}
    const root = view(state, data)
    return { state, view: native === true ? root : __widget_tree(root).view }
  }
  const next = __widget_dispatch(input.state, input.event ?? {}, data, native === true)
  const result = next instanceof __WidgetResult ? next : undefined
  const state = result
    ? result.state === undefined
      ? input.state
      : result.state
    : next === undefined
      ? input.state
      : next
  const root = view(state, data)
  const output = { state, view: native === true ? root : __widget_tree(root).view }
  if (result?.kind === "dismiss") output.dismiss = true
  if (result?.kind === "send") output.send = result.value
  if (result?.kind === "submit") output.submit = result.value
  return output
}

// Routes one client event: system events to the widget template's hooks, control events to the handler of the node with
// that id in the view of the current state. Nothing else sees either; an event nobody takes changes nothing.
function __widget_dispatch(state, event, data, native) {
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
  const root = view(state, data)
  const entry = native ? __widget_find(root, event.id) : __widget_tree(root).handlers[event.id]
  if (!entry || entry.event !== event.type) return undefined
  const value = __widget_value(entry, event.value)
  if (value === undefined) return undefined
  return event.type === "press" ? entry.handler(state) : entry.handler(state, value)
}

// Live mode (specs/v2/widgets-live.md): `main(data)` runs once, on the host's `__host.post`, `__host.receive`,
// `__host.sleep`, `__host.now` and `__host.fetch`. While the view has handlers, hooks are registered or a frame is
// awaited, a pump receives client messages and calls handlers and hooks between the program's awaits.
const widget = (() => {
  const hooks = { key: [], focus: [], fullscreen: [], capture: [], resumed: [] }
  const live = {
    frame: null,
    requested: false,
    waiting: [],
    handlers: {},
    canvases: {},
    // Native host: the last rendered view as built, and whether the host found handlers in it.
    native: false,
    root: undefined,
    interactive: false,
    pumping: false,
    done: false,
    idle: null,
    reject: null,
  }
  const api = {}
  const post = (message) => (live.done ? undefined : __host.post(message))
  const wanted = () =>
    !live.done &&
    (live.waiting.length > 0 ||
      (live.native ? live.interactive : Object.keys(live.handlers).length > 0) ||
      Object.values(hooks).some((list) => list.length > 0))
  const fail = (error) => live.reject?.(error)
  // Runs a handler or hook; an async one that rejects fails the program like a throw.
  const call = (handler, ...args) => {
    const result = handler(...args)
    if (result && typeof result.then === "function") result.then(undefined, fail)
  }
  const emit = (kind, ...values) => hooks[kind].slice().forEach((hook) => call(hook, ...values))
  const dispatch = (event) => {
    if (event.type === "key") {
      const key = __widget_key(event.value)
      if (!key) return
      if (key.kind === "down") api.keys.add(key.code)
      else api.keys.delete(key.code)
      return emit("key", key)
    }
    if (event.type === "focus") {
      if (event.value !== true) api.keys.clear()
      return emit("focus", event.value === true)
    }
    if (event.type === "fullscreen") return emit("fullscreen", event.value === true, __widget_rect(event.close))
    if (event.type === "capture") return emit("capture", event.value === true)
    if (event.type === "pointer") api.pointer = __widget_pointer(event.value) ?? api.pointer
    const entry = live.native ? __widget_find(live.root, event.id) : live.handlers[event.id]
    if (!entry || entry.event !== event.type) return
    const value = __widget_value(entry, event.value)
    if (value === undefined) return
    if (event.type === "press") call(entry.handler)
    else call(entry.handler, value)
  }
  const accept = (message) => {
    if (message.type === "event") return dispatch(message.event ?? {})
    if (message.type === "resumed") return emit("resumed", message.pausedMs)
    if (message.type !== "frame") return
    live.requested = false
    live.frame = message.frame
    // Every waiter gets this frame: one left over from a race (`Promise.race([widget.frame(), ...])`) too.
    const waiting = live.waiting.splice(0)
    if (waiting.length > 0) {
      const frame = take()
      waiting.forEach((resolve) => resolve(frame))
    }
  }
  const pump = async () => {
    if (live.pumping) return
    live.pumping = true
    try {
      while (wanted()) accept(await __host.receive())
    } catch (error) {
      fail(error)
    } finally {
      live.pumping = false
      if (!wanted()) live.idle?.()
    }
  }
  const request = () => {
    if (live.requested || live.frame) return
    live.requested = true
    post({ type: "frame" })
  }
  const take = () => {
    const frame = live.frame
    live.frame = null
    return frame
  }
  const response = (raw) => {
    const text = raw.body ?? atob(raw.body64 ?? "")
    return {
      ok: raw.status >= 200 && raw.status < 300,
      status: raw.status,
      headers: raw.headers ?? {},
      text: async () => text,
      json: async () => JSON.parse(text),
    }
  }
  Object.assign(api, {
    keys: new Set(),
    pointer: null,
    render: (node) => {
      if (live.native) {
        live.root = node
        try {
          live.interactive = post({ type: "render", node }) === true
        } catch (error) {
          // A view too deep to cross: the host fails the run with the reason.
          if (!__widget_deep([node], 1)) throw error
          post({ type: "render", node: null, failure: __WIDGET_DEEP })
        }
      } else {
        const tree = __widget_tree(node)
        live.handlers = tree.handlers
        live.canvases = tree.canvases
        post({ type: "render", node: tree.view })
      }
      pump()
    },
    draw: (key, commands) => {
      // A native host knows the canvases by key and throws these errors itself.
      if (live.native)
        return void post({
          type: "draw",
          key: String(key),
          commands: commands instanceof __WidgetDraw ? commands.commands : commands,
        })
      const canvas = live.canvases[String(key)]
      if (canvas === undefined) throw new Error('No canvas with key "' + key + '" in the rendered view')
      if (canvas.wgsl) throw new Error('Canvas "' + key + '" is drawn by its wgsl; it takes no draw commands')
      post({ type: "draw", id: canvas.id, commands: commands instanceof __WidgetDraw ? commands.commands : commands })
    },
    frame: async () => {
      request()
      if (live.frame) return take()
      const next = new Promise((resolve) => live.waiting.push(resolve))
      pump()
      return next
    },
    on: (kind, hook) => {
      if (!hooks[kind]) throw new Error('widget.on: unknown event "' + kind + '"')
      if (typeof hook !== "function") throw new Error("widget.on needs a function")
      hooks[kind].push(hook)
      pump()
      return () => {
        const index = hooks[kind].indexOf(hook)
        if (index !== -1) hooks[kind].splice(index, 1)
      }
    },
    sleep: (ms) => __host.sleep(ms),
    now: () => __host.now(),
    submit: (value) => {
      post({ type: "submit", value: value ?? null })
      live.done = true
    },
    dismiss: () => {
      post({ type: "dismiss" })
      live.done = true
    },
    fetch: async (url, init) => {
      const request = { url: String(url), method: init?.method ?? "GET", headers: init?.headers ?? {} }
      if (init?.body !== undefined) request.body = String(init.body)
      try {
        return response(await __host.fetch(request))
      } catch (error) {
        throw { kind: error?.kind ?? "Network", message: error?.message ?? String(error) }
      }
    },
    send: (value, options) => post({ type: "send", value: value ?? null, wake: options?.wake !== false }),
    capturePointer: () => post({ type: "capture", value: true }),
    releasePointer: () => post({ type: "capture", value: false }),
  })
  // Runs `main`, then keeps the widget interactive while its view has handlers or hooks are registered.
  api.__run = async (data, native) => {
    live.native = native
    const failed = new Promise((_, reject) => (live.reject = reject))
    failed.catch(() => {})
    await Promise.race([main(data), failed])
    if (!wanted()) return
    await Promise.race([new Promise((resolve) => (live.idle = resolve)), failed])
  }
  return api
})()

async function __widget_live(input, native) {
  await widget.__run(input.data, native === true)
  return null
}
