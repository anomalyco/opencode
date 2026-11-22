// Widget prelude (specs/v2/widgets.md). A widget program is this prelude, a newline, then the widget template source.
// Hosts run `<program>\nreturn __widget_step(__input())` with `__input` as the only host global.

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
function __widget_tree(root) {
  const handlers = {}
  const canvases = {}
  const used = {}
  const visit = (node, path) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node
    const { key, id, pointer, onPress, onChange, onPointer, children, ...out } = node
    const control = __WIDGET_CONTROLS[node.type]
    if (control) {
      const handler = node[control.handler]
      const keyed = control.keyed && key !== undefined && key !== null
      if (typeof handler === "function" || control.always || keyed) {
        out.id = path
        if (typeof handler === "function") handlers[path] = { event: control.event, handler, node: out }
        // Only a canvas with a handler takes input; one with just a key has an id for `widget.draw`.
        if (node.type === "canvas" && typeof handler === "function") out.pointer = true
        if (keyed && canvases[String(key)] === undefined)
          canvases[String(key)] = { id: path, wgsl: typeof node.wgsl === "string" }
      }
    }
    if (children === undefined) return out
    const items = []
    const collect = (value, at) => {
      if (Array.isArray(value))
        value.forEach((item, index) => collect(item, at === "" ? String(index) : at + "." + index))
      else if (value) items.push([value, at])
    }
    collect(Array.isArray(children) ? children : [children], "")
    out.children = items.map(([child, at]) => {
      const named = child && typeof child === "object" && child.key !== undefined && child.key !== null
      let next = path + "/" + (named ? ":" + encodeURIComponent(String(child.key)) : at)
      // Repeated keys among siblings still get distinct ids, in order.
      used[next] = (used[next] ?? 0) + 1
      if (used[next] > 1) next = next + "~" + used[next]
      return visit(child, next)
    })
    return out
  }
  const named = root && typeof root === "object" && root.key !== undefined && root.key !== null
  const view = visit(root, named ? ":" + encodeURIComponent(String(root.key)) : "0")
  return { view, handlers, canvases }
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

function __widget_step(input) {
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
    return { state, view: __widget_tree(view(state, data)).view }
  }
  const next = __widget_dispatch(input.state, input.event ?? {}, data)
  const result = next instanceof __WidgetResult ? next : undefined
  const state = result
    ? result.state === undefined
      ? input.state
      : result.state
    : next === undefined
      ? input.state
      : next
  const output = { state, view: __widget_tree(view(state, data)).view }
  if (result?.kind === "dismiss") output.dismiss = true
  if (result?.kind === "send") output.send = result.value
  if (result?.kind === "submit") output.submit = result.value
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
  const entry = __widget_tree(view(state, data)).handlers[event.id]
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
    pumping: false,
    done: false,
    idle: null,
    reject: null,
  }
  const api = {}
  const post = (message) => {
    if (!live.done) __host.post(message)
  }
  const wanted = () =>
    !live.done &&
    (live.waiting.length > 0 ||
      Object.keys(live.handlers).length > 0 ||
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
    const entry = live.handlers[event.id]
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
      const tree = __widget_tree(node)
      live.handlers = tree.handlers
      live.canvases = tree.canvases
      post({ type: "render", node: tree.view })
      pump()
    },
    draw: (key, commands) => {
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
  api.__run = async (data) => {
    const failed = new Promise((_, reject) => (live.reject = reject))
    failed.catch(() => {})
    await Promise.race([main(data), failed])
    if (!wanted()) return
    await Promise.race([new Promise((resolve) => (live.idle = resolve)), failed])
  }
  return api
})()

async function __widget_live(input) {
  await widget.__run(input.data)
  return null
}
