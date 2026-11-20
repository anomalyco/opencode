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
