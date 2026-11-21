// A conversion funnel: stages as centered bars sized by value, joined by tapering bands, with the conversion from the
// previous stage on the right. Bars widen in; tap a stage to select it. With `choose`, the Choose button submits it.

const ROW = 44
const INTRO = 0.7

function init(data) {
  return { selected: null }
}

function view(state, data) {
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: data.stages.length * ROW + 4,
      fps: 60,
      duration: INTRO,
      alt: summary(data),
    }),
    ui.text(state.selected === null ? "Tap a stage to see its conversion" : describe(data, state.selected), {
      style: "caption",
      tone: state.selected === null ? "muted" : "default",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose stage", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: state.selected === null,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const stage = data.stages[state.selected]
    return submit({ label: stage.label, index: state.selected, value: stage.value, ...rates(data, state.selected) })
  }
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const index = Math.floor((pointer.y - 2) / ROW)
  const hit = index >= 0 && index < data.stages.length ? index : null
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(data, frame.width)
  const grow = ease(frame.t / INTRO)
  const hover = frame.pointer && !frame.pointer.down ? Math.floor((frame.pointer.y - 2) / ROW) : null
  const active = hover !== null && hover >= 0 && hover < data.stages.length ? hover : state.selected
  const fill = data.color ?? "accent"
  const half = (index) => (Math.max(0.02, data.stages[index].value / box.max) * box.w * grow) / 2
  const bar = ROW - 16
  data.stages.forEach((stage, index) => {
    const y = 2 + index * ROW
    if (index > 0) {
      const above = half(index - 1)
      const below = half(index)
      g.save().alpha(0.15)
      g.path(
        [
          ["M", box.cx - above, y - 16 + 2],
          ["L", box.cx + above, y - 16 + 2],
          ["L", box.cx + below, y + 8],
          ["L", box.cx - below, y + 8],
          ["Z"],
        ],
        fill,
      )
      g.restore()
    }
    const dim = active !== null && active !== index
    if (dim) g.save().alpha(0.5)
    g.rrect(box.cx - half(index), y + 8, half(index) * 2, bar, 6, fill)
    if (dim) g.restore()
    g.text(8, y + 8 + bar / 2 - 2, fit(stage.label, box.left - 14, 12), {
      size: 12,
      weight: index === active ? 600 : 400,
    })
    g.text(8, y + 8 + bar / 2 + 13, amount(stage.value, data.unit), { size: 11, color: "muted" })
    if (half(index) * 2 > 60)
      g.text(box.cx, y + 8 + bar / 2 + 4, percent(stage.value / data.stages[0].value), {
        size: 12,
        weight: 600,
        align: "center",
        color: "#ffffff",
      })
    if (index > 0)
      g.text(frame.width - 8, y + 8 + bar / 2 + 4, percent(stage.value / data.stages[index - 1].value), {
        size: 12,
        align: "right",
        color: "muted",
      })
    if (index === state.selected)
      g.rrect(box.cx - half(index) - 2, y + 6, half(index) * 2 + 4, bar + 4, 7, { stroke: "text", width: 1.5 })
  })
  return g.commands
}

function layout(data, width) {
  const left = Math.min(
    width * 0.3,
    Math.max(70, 16 + 6.6 * Math.max(...data.stages.map((stage) => stage.label.length))),
  )
  const right = 56
  const w = Math.max(20, width - left - right)
  return { left, w, cx: left + w / 2, max: Math.max(...data.stages.map((stage) => stage.value), 1e-9) }
}

function rates(data, index) {
  const first = data.stages[0].value
  const previous = data.stages[Math.max(0, index - 1)].value
  const round = (value) => Math.round(value * 1000) / 1000
  return {
    ofFirst: first ? round(data.stages[index].value / first) : 0,
    ofPrevious: previous ? round(data.stages[index].value / previous) : 0,
  }
}

function describe(data, index) {
  const stage = data.stages[index]
  const rate = rates(data, index)
  if (index === 0) return stage.label + ": " + amount(stage.value, data.unit)
  return (
    stage.label +
    ": " +
    amount(stage.value, data.unit) +
    " · " +
    percent(rate.ofPrevious) +
    " of " +
    data.stages[index - 1].label +
    ", " +
    percent(rate.ofFirst) +
    " of " +
    data.stages[0].label +
    " · drop-off " +
    amount(data.stages[index - 1].value - stage.value, data.unit)
  )
}

function summary(data) {
  return (
    "Funnel. " +
    data.stages
      .map(
        (stage, index) =>
          stage.label +
          " " +
          amount(stage.value, data.unit) +
          (index ? " (" + percent(stage.value / data.stages[index - 1].value) + " of previous)" : ""),
      )
      .join(", ")
  )
}

function percent(share) {
  return (Number.isFinite(share) ? Math.round(share * 1000) / 10 : 0) + "%"
}

function amount(value, unit) {
  const text = String(Math.round(value * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  if (!unit) return text
  return unit.length > 1 && /^[a-z]/i.test(unit) ? text + " " + unit : text + unit
}

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
