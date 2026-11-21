// A sequence diagram: participants as columns with lifelines and messages between them, top to bottom in order.
// Kinds: "sync" (solid, filled arrow), "async" (solid, open arrow) and "reply" (dashed, open arrow); a message to
// itself loops back. Messages play in one after another; tap one to select it. With `choose`, the Choose button submits it.

const HEAD = 34
const ROW = 36

function init(data) {
  for (const message of data.messages) [message.from, message.to].forEach((name) => participant(data, name))
  return { selected: null }
}

function view(state, data) {
  const picked = state.selected === null ? null : data.messages[state.selected]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEAD + 14 + data.messages.length * ROW + 8,
      fps: 60,
      duration: intro(data),
      alt: summary(data),
    }),
    ui.text(picked ? describe(data, state.selected) : "Tap a message to select it", {
      style: "caption",
      tone: picked ? "default" : "muted",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose message", { onPress: (state) => choose(state, data), variant: "primary", disabled: !picked }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const message = data.messages[state.selected]
    return submit({ index: state.selected, from: message.from, to: message.to, label: message.label })
  }
  return state
}

function tap(state, data, pointer) {
  pointer = below(pointer)
  if (pointer.kind !== "up") return state
  const hit = locate(data, pointer.y)
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  frame = below(frame)
  const g = ui.draw()
  if (frame.top) g.translate(0, frame.top)
  const columns = layout(data, frame.width)
  const bottom = frame.height - 4
  const hover = frame.pointer && !frame.pointer.down ? locate(data, frame.pointer.y) : null
  columns.forEach((column) => {
    g.path(dashes(column.x, HEAD, column.x, bottom, 4, 4), { stroke: "border", width: 1 })
    g.rrect(column.x - column.w / 2, 2, column.w, HEAD - 6, 6, { fill: "surface", stroke: "border", width: 1 })
    g.text(column.x, HEAD / 2 + 3, column.label, { size: 12, weight: 600, align: "center" })
  })
  const step = (intro(data) - 0.5) / Math.max(1, data.messages.length - 1)
  data.messages.forEach((message, index) => {
    const grow = ease((frame.t - 0.2 - index * step) / 0.3)
    if (grow <= 0) return
    const y = HEAD + 14 + index * ROW + ROW / 2 + 6
    const from = columns[participant(data, message.from)].x
    const to = columns[participant(data, message.to)].x
    const active = index === state.selected || index === hover
    if (index === state.selected)
      g.save()
        .alpha(0.08)
        .rect(0, y - ROW + 8, frame.width, ROW, "text")
        .restore()
    const stroke = active ? "accent" : message.kind === "reply" ? "muted" : "text"
    const width = active ? 2 : 1.25
    const kind = message.kind ?? "sync"
    g.save().alpha(grow)
    if (from === to) {
      const loop = Math.min(36, frame.width - from - 8)
      g.path(
        [
          ["M", from, y - 8],
          ["L", from + loop, y - 8],
          ["L", from + loop, y + 6],
          ["L", from + 2, y + 6],
        ],
        { stroke, width },
      )
      head(g, from + 2, y + 6, -1, stroke, kind)
      g.text(from + loop + 6, y + 2, fit(number(data, index) + message.label, frame.width - from - loop - 10, 12), {
        size: 12,
        color: active ? "text" : "muted",
      })
    } else {
      const dir = to > from ? 1 : -1
      const end = from + (to - from) * grow
      if (kind === "reply") g.path(dashes(from, y, end - dir * 2, y, 6, 4), { stroke, width })
      else g.line(from, y, end - dir * 2, y, { stroke, width })
      if (grow >= 1) head(g, to, y, dir, stroke, kind)
      g.text((from + to) / 2, y - 6, fit(number(data, index) + message.label, Math.abs(to - from) - 12, 12), {
        size: 12,
        align: "center",
        weight: active ? 600 : 400,
        color: active ? "text" : kind === "reply" ? "muted" : "text",
      })
    }
    g.restore()
  })
  return g.commands
}

function layout(data, width) {
  const slot = (width - 8) / data.participants.length
  return data.participants.map((name, index) => ({
    label: fit(name, slot - 20, 12),
    x: 4 + slot * (index + 0.5),
    w: Math.min(slot - 10, 7.2 * name.length + 22),
  }))
}

function participant(data, name) {
  const index = data.participants.indexOf(name)
  if (index < 0) throw new Error('Unknown participant "' + name + '" in messages')
  return index
}

function locate(data, y) {
  const index = Math.floor((y - HEAD - 14) / ROW)
  return index >= 0 && index < data.messages.length ? index : null
}

// One path of dash segments: a single draw command however long the line is.
function dashes(x1, y1, x2, y2, on, off) {
  const length = Math.hypot(x2 - x1, y2 - y1)
  const dx = (x2 - x1) / (length || 1)
  const dy = (y2 - y1) / (length || 1)
  const segments = []
  for (let at = 0; at < length; at += on + off) {
    const stop = Math.min(length, at + on)
    segments.push(["M", x1 + dx * at, y1 + dy * at], ["L", x1 + dx * stop, y1 + dy * stop])
  }
  return segments
}

function head(g, x, y, dir, stroke, kind) {
  if (kind === "sync") g.path([["M", x, y], ["L", x - dir * 9, y - 4.5], ["L", x - dir * 9, y + 4.5], ["Z"]], stroke)
  else
    g.path(
      [
        ["M", x - dir * 9, y - 5],
        ["L", x, y],
        ["L", x - dir * 9, y + 5],
      ],
      { stroke, width: 1.5 },
    )
}

function intro(data) {
  return Math.round(Math.min(2.4, 0.5 + 0.12 * data.messages.length) * 100) / 100
}

function number(data, index) {
  return data.numbered ? index + 1 + ". " : ""
}

function describe(data, index) {
  const message = data.messages[index]
  return (
    index +
    1 +
    ". " +
    message.from +
    " → " +
    message.to +
    ": " +
    message.label +
    (message.kind && message.kind !== "sync" ? " (" + message.kind + ")" : "")
  )
}

function summary(data) {
  return (
    "Sequence diagram between " +
    data.participants.join(", ") +
    ". " +
    data.messages.map((_, index) => describe(data, index)).join("; ")
  )
}

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}

// In full screen, the layout starts below the close button when it overlaps this canvas (widgets-fullscreen.md):
// `close` comes with the frame and the pointer, so drawing and hit testing agree.
function below(area) {
  const top = area.close ? Math.max(0, area.close.y + area.close.height) : 0
  if (top === 0) return area
  return {
    ...area,
    top,
    height: area.height - top,
    ...(typeof area.y === "number" ? { y: area.y - top } : {}),
    ...(area.pointer ? { pointer: { ...area.pointer, y: area.pointer.y - top } } : {}),
  }
}
