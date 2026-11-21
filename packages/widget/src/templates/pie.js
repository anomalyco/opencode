// A pie or donut chart. Slices sweep in; tap a slice to select it (it pulls out) and tap a legend entry to hide or
// show its slice. With `choose`, the Choose button submits the selected slice.

const HEIGHT = 240
const INTRO = 0.7
const START = -Math.PI / 2
const ROW = 20
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

function init(data) {
  return { selected: null, hidden: [] }
}

function view(state, data) {
  const picked = state.selected === null ? null : data.slices[state.selected]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: INTRO,
      alt: summary(data),
    }),
    ui.text(
      picked
        ? picked.label +
            ": " +
            amount(picked.value, data.unit) +
            " (" +
            percent(picked.value / total(data, state)) +
            ")"
        : "Tap a slice to select it, or a legend entry to hide it",
      { style: "caption", tone: picked ? "default" : "muted" },
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button(picked ? "Choose " + picked.label : "Choose", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: !picked,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const slice = data.slices[state.selected]
    const share = Math.round((slice.value / total(data, state)) * 1000) / 1000
    return submit({ label: slice.label, index: state.selected, value: slice.value, share })
  }
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const hit = locate(layout(data, state, pointer.width, pointer.height), pointer.x, pointer.y)
  if (!hit) return { ...state, selected: null }
  if (hit.kind === "legend") {
    const hidden = state.hidden.includes(hit.index)
      ? state.hidden.filter((index) => index !== hit.index)
      : [...state.hidden, hit.index]
    return { hidden, selected: state.selected === hit.index ? null : state.selected }
  }
  return { ...state, selected: state.selected === hit.index ? null : hit.index }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(data, state, frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(box, frame.pointer.x, frame.pointer.y) : null
  const active = hover && hover.kind === "slice" ? hover.index : state.selected
  const end = START + ease(frame.t / INTRO) * Math.PI * 2
  if (box.slices.length === 0) g.circle(box.cx, box.cy, box.r, { stroke: "border", width: 1.5 })
  for (const slice of box.slices) {
    const to = Math.min(slice.to, end)
    if (to <= slice.from) continue
    const mid = (slice.from + slice.to) / 2
    const out = slice.index === active ? 8 : 0
    const cx = box.cx + Math.cos(mid) * out
    const cy = box.cy + Math.sin(mid) * out
    g.path(wedge(cx, cy, box.r, box.inner, slice.from, to), { fill: slice.color, stroke: "bg", width: 2 })
    if (to === slice.to && slice.to - slice.from > 0.35 && box.r > 60) {
      const at = box.inner ? (box.r + box.inner) / 2 : box.r * 0.66
      g.text(cx + Math.cos(mid) * at, cy + Math.sin(mid) * at + 4, percent(slice.share), {
        size: 11,
        weight: 600,
        align: "center",
        color: "#ffffff",
      })
    }
  }
  if (box.inner) {
    const picked = active === null ? null : box.slices.find((slice) => slice.index === active)
    g.text(box.cx, box.cy - 2, picked ? fit(data.slices[active].label, box.inner * 1.6, 11) : "Total", {
      size: 11,
      align: "center",
      color: "muted",
    })
    g.text(box.cx, box.cy + 16, picked ? percent(picked.share) : compact(box.total), {
      size: 16,
      weight: 600,
      align: "center",
    })
  }
  legend(g, data, state, box, active)
  return g.commands
}

// Geometry shared by draw and tap: the pie on the left, the legend on the right.
function layout(data, state, width, height) {
  const legendWidth = Math.min(210, Math.max(110, width * 0.38))
  const r = Math.max(20, Math.min(height / 2 - 14, (width - legendWidth) / 2 - 18))
  const sum = total(data, state)
  const slices = []
  let from = START
  data.slices.forEach((slice, index) => {
    if (state.hidden.includes(index) || slice.value <= 0 || sum <= 0) return
    const to = from + (slice.value / sum) * Math.PI * 2
    slices.push({ index, from, to, share: slice.value / sum, color: color(slice, index) })
    from = to
  })
  return {
    cx: (width - legendWidth) / 2,
    cy: height / 2,
    r,
    inner: data.donut ? r * 0.58 : 0,
    total: sum,
    slices,
    legend: {
      x: width - legendWidth + 6,
      y: height / 2 - (data.slices.length * ROW) / 2,
      w: legendWidth - 12,
      rows: data.slices.length,
    },
  }
}

function locate(box, px, py) {
  const legend = box.legend
  if (px >= legend.x - 4 && py >= legend.y && py < legend.y + legend.rows * ROW)
    return { kind: "legend", index: Math.floor((py - legend.y) / ROW) }
  const distance = Math.hypot(px - box.cx, py - box.cy)
  if (distance > box.r + 10 || distance < box.inner) return null
  let angle = Math.atan2(py - box.cy, px - box.cx)
  if (angle < START) angle += Math.PI * 2
  const slice = box.slices.find((slice) => angle >= slice.from && angle < slice.to)
  return slice ? { kind: "slice", index: slice.index } : null
}

function legend(g, data, state, box, active) {
  data.slices.forEach((slice, index) => {
    const y = box.legend.y + index * ROW + ROW / 2
    const hidden = state.hidden.includes(index)
    const fill = color(slice, index)
    g.circle(box.legend.x + 5, y, 5, hidden ? { stroke: fill, width: 1.5 } : fill)
    const share = box.slices.find((item) => item.index === index)
    const right = share ? percent(share.share) : ""
    g.text(box.legend.x + 16, y + 4, fit(slice.label, box.legend.w - 22 - 7 * right.length, 12), {
      size: 12,
      weight: index === active ? 600 : 400,
      color: hidden ? "muted" : "text",
    })
    if (right) g.text(box.legend.x + box.legend.w, y + 4, right, { size: 12, align: "right", color: "muted" })
  })
}

// A slice as a path: arcs are cubic Béziers of at most a quarter turn each.
function wedge(cx, cy, r, inner, from, to) {
  const segments = [["M", cx + Math.cos(from) * r, cy + Math.sin(from) * r]]
  arc(segments, cx, cy, r, from, to)
  if (inner > 0) {
    segments.push(["L", cx + Math.cos(to) * inner, cy + Math.sin(to) * inner])
    arc(segments, cx, cy, inner, to, from)
  } else segments.push(["L", cx, cy])
  segments.push(["Z"])
  return segments
}

function arc(segments, cx, cy, r, from, to) {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)))
  const step = (to - from) / steps
  const k = (4 / 3) * Math.tan(step / 4)
  for (let i = 0; i < steps; i++) {
    const a = from + i * step
    const b = a + step
    segments.push([
      "C",
      cx + r * (Math.cos(a) - k * Math.sin(a)),
      cy + r * (Math.sin(a) + k * Math.cos(a)),
      cx + r * (Math.cos(b) + k * Math.sin(b)),
      cy + r * (Math.sin(b) - k * Math.cos(b)),
      cx + r * Math.cos(b),
      cy + r * Math.sin(b),
    ])
  }
}

function total(data, state) {
  return data.slices.reduce((sum, slice, index) => (state.hidden.includes(index) ? sum : sum + slice.value), 0)
}

function summary(data) {
  const sum = data.slices.reduce((total, slice) => total + slice.value, 0)
  return (
    (data.donut ? "Donut" : "Pie") +
    " chart. " +
    data.slices
      .map((slice) => slice.label + " " + amount(slice.value, data.unit) + " (" + percent(slice.value / sum) + ")")
      .join(", ")
  )
}

function color(slice, index) {
  return slice.color ?? PALETTE[index % PALETTE.length]
}

function percent(share) {
  return (Number.isFinite(share) ? Math.round(share * 1000) / 10 : 0) + "%"
}

function amount(value, unit) {
  const text = String(Math.round(value * 100) / 100)
  if (!unit) return text
  return unit.length > 1 && /^[a-z]/i.test(unit) ? text + " " + unit : text + unit
}

function compact(value) {
  const size = Math.abs(value)
  const round = (number) => String(Math.round(number * 10) / 10)
  if (size >= 1e9) return round(value / 1e9) + "B"
  if (size >= 1e6) return round(value / 1e6) + "M"
  if (size >= 1e4) return round(value / 1e3) + "k"
  return String(Math.round(value * 100) / 100)
}

// Truncates text to about `width` pixels at font `size`.
function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
