// Widget prelude (specs/v2/widgets.md). A widget program is this prelude, a newline, then the template source.
// Hosts run `<program>\nreturn __widget_step(__input())` with `__input` as the only host global.

const ui = (() => {
  // Children may nest arrays and contain null, undefined or false, so templates can write `cond && node` and `...list`.
  const children = (value) => [value].flat(Infinity).filter(Boolean)
  const container = (type) => (props, nodes) =>
    Array.isArray(props) ? { type, children: children(props) } : { ...props, type, children: children(nodes) }
  return {
    column: container("column"),
    row: container("row"),
    carousel: container("carousel"),
    card: container("card"),
    text: (text, props) => ({ ...props, type: "text", text: String(text) }),
    markdown: (text) => ({ type: "markdown", text: String(text) }),
    image: (src, props) => ({ ...props, type: "image", src }),
    button: (id, label, props) => ({ ...props, type: "button", id, label }),
    checkbox: (id, label, checked, props) => ({ ...props, type: "checkbox", id, label, checked: checked === true }),
    slider: (id, props) => ({ ...props, type: "slider", id }),
    select: (id, options, props) => ({ ...props, type: "select", id, options }),
    input: (id, value, props) => ({ ...props, type: "input", id, value: value ?? "" }),
    divider: () => ({ type: "divider" }),
    canvas: (props) => ({ ...props, type: "canvas" }),
    shader: (wgsl, props) => ({ ...props, type: "shader", wgsl }),
    draw: () => new __WidgetDraw(),
  }
})()

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

function submit(value, state) {
  return new __WidgetResult("submit", value, state)
}

function dismiss(state) {
  return new __WidgetResult("dismiss", undefined, state)
}

// Sends a message to the agent without closing the widget; `wake: false` lets the agent see it only on its next turn.
function send(value, state, options) {
  return new __WidgetResult("send", { value: value ?? null, wake: options?.wake !== false }, state)
}

function __widget_step(input) {
  const data = input.data
  if (input.phase === "draw") {
    const drawn = typeof draw === "function" ? draw(input.state, data, input.frame) : undefined
    return { commands: (drawn instanceof __WidgetDraw ? drawn.commands : drawn) ?? [] }
  }
  if (input.phase === "init") {
    const state = (typeof init === "function" ? init(data) : undefined) ?? {}
    return { state, view: view(state, data) }
  }
  const next = (typeof update === "function" ? update(input.state, input.event, data) : undefined) ?? input.state
  if (!(next instanceof __WidgetResult)) return { state: next, view: view(next, data) }
  const state = next.state ?? input.state
  if (next.kind === "dismiss") return { state, view: view(state, data), dismiss: true }
  if (next.kind === "send") return { state, view: view(state, data), send: next.value }
  return { state, view: view(state, data), submit: next.value ?? null }
}

// Live mode (specs/v2/widgets-live.md): `main(data)` runs once, for as long as the widget is open, on the host's
// `__host.post`, `__host.receive`, `__host.sleep`, `__host.now` and `__host.fetch`. Messages from the client are
// buffered here, so waiting for one kind (a frame) keeps the others (events) for later.
const widget = (() => {
  const events = []
  const live = { frame: null, requested: false, receiving: null, alarm: null, paused: null, done: false }
  const post = (message) => {
    if (!live.done) __host.post(message)
  }
  const accept = (message) => {
    live.receiving = null
    if (message.type === "event") events.push(message.event)
    if (message.type === "frame") {
      live.requested = false
      live.frame = message.frame
    }
    // Resumes not seen yet add up into one.
    if (message.type === "resumed") live.paused = (live.paused ?? 0) + message.pausedMs
  }
  // At most one receive is in flight: one left over from a timed-out wait is reused by the next wait.
  const pull = () => live.receiving ?? (live.receiving = __host.receive().then(accept))
  // At most one timer per deadline is in flight, so a loop that waits with the same deadline doesn't pile up sleeps.
  const alarm = (deadline) => {
    if (live.alarm && live.alarm.at <= deadline) return live.alarm.promise
    const entry = { at: deadline, promise: null }
    entry.promise = __host.sleep(deadline - __host.now()).then(() => {
      if (live.alarm === entry) live.alarm = null
    })
    live.alarm = entry
    return entry.promise
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
  return {
    render: (node) => post({ type: "render", node }),
    draw: (id, commands) =>
      post({ type: "draw", id, commands: commands instanceof __WidgetDraw ? commands.commands : commands }),
    event: async () => {
      while (events.length === 0) await pull()
      return events.shift()
    },
    frame: async () => {
      request()
      while (!live.frame) await pull()
      return take()
    },
    sleep: (ms) => __host.sleep(ms),
    now: () => __host.now(),
    next: async (options) => {
      const frame = options?.frame === true
      const deadline = typeof options?.timeout === "number" ? __host.now() + Math.max(0, options.timeout) : undefined
      if (frame) request()
      while (true) {
        if (live.paused !== null) {
          const pausedMs = live.paused
          live.paused = null
          return { type: "resumed", pausedMs }
        }
        if (events.length > 0) return { type: "event", event: events.shift() }
        if (frame && live.frame) return { type: "frame", frame: take() }
        if (deadline === undefined) await pull()
        else if (__host.now() >= deadline) return { type: "timeout" }
        else await Promise.race([pull(), alarm(deadline)])
      }
    },
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
  }
})()

async function __widget_live(input) {
  await main(input.data)
  return null
}
