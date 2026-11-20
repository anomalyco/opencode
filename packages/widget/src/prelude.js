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
  }
})()

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

function __widget_step(input) {
  const data = input.data
  if (input.phase === "init") {
    const state = (typeof init === "function" ? init(data) : undefined) ?? {}
    return { state, view: view(state, data) }
  }
  const next = (typeof update === "function" ? update(input.state, input.event, data) : undefined) ?? input.state
  if (!(next instanceof __WidgetResult)) return { state: next, view: view(next, data) }
  const state = next.state ?? input.state
  if (next.kind === "dismiss") return { state, view: view(state, data), dismiss: true }
  return { state, view: view(state, data), submit: next.value ?? null }
}
