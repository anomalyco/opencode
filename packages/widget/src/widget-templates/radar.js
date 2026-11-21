// A radar (spider) chart: one polygon per series over 3 to 12 axes on a shared scale. Polygons grow in; tap near an
// axis to compare every series on it, tap a legend entry to hide a series. With `choose`, the Choose button submits the
// selected axis with each series' value.

const HEIGHT = 300
const INTRO = 0.7
const RINGS = 4
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"]

function init(data) {
  return { selected: null, hidden: [] }
}

function view(state, data) {
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
      state.selected === null
        ? "Tap an axis to compare the series; tap a legend entry to hide one"
        : describe(state, data, state.selected),
      {
        style: "caption",
        tone: state.selected === null ? "muted" : "default",
      },
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose axis", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: state.selected === null,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null)
    return submit({
      axis: data.axes[state.selected],
      index: state.selected,
      values: Object.fromEntries(data.series.map((series) => [series.label, series.values[state.selected]])),
    })
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const box = layout(data, pointer.width, pointer.height)
  const entry = box.legend.findIndex(
    (item) => pointer.y >= item.y - 9 && pointer.y <= item.y + 9 && pointer.x <= box.legendRight,
  )
  if (entry >= 0) {
    const hidden = state.hidden.includes(entry)
      ? state.hidden.filter((index) => index !== entry)
      : [...state.hidden, entry]
    return hidden.length === data.series.length ? state : { ...state, hidden }
  }
  const hit = axisAt(data, box, pointer.x, pointer.y)
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(data, frame.width, frame.height)
  const n = data.axes.length
  const hover = frame.pointer && !frame.pointer.down ? axisAt(data, box, frame.pointer.x, frame.pointer.y) : null
  const active = hover ?? state.selected
  for (let ring = 1; ring <= RINGS; ring++) {
    const r = (box.r * ring) / RINGS
    g.path([...data.axes.map((_, index) => [index === 0 ? "M" : "L", ...point(box, index, n, r)]), ["Z"]], {
      stroke: "border",
      width: 1,
    })
  }
  g.text(box.cx + 4, box.cy - box.r - 4 + 12, compact(box.max), { size: 10, color: "muted" })
  data.axes.forEach((axis, index) => {
    const [x, y] = point(box, index, n, box.r)
    g.line(box.cx, box.cy, x, y, { stroke: index === active ? "text" : "border", width: index === active ? 1.5 : 1 })
    const [lx, ly] = point(box, index, n, box.r + 14)
    const align = Math.abs(lx - box.cx) < 8 ? "center" : lx > box.cx ? "left" : "right"
    g.text(lx, ly + 4, fit(axis, 110, 11), {
      size: 11,
      align,
      weight: index === active ? 600 : 400,
      color: index === active ? "text" : "muted",
    })
  })
  const grow = ease(frame.t / INTRO)
  data.series.forEach((series, at) => {
    if (state.hidden.includes(at)) return
    const color = series.color ?? PALETTE[at % PALETTE.length]
    const points = series.values
      .slice(0, n)
      .map((value, index) => point(box, index, n, (box.r * Math.max(0, value) * grow) / box.max))
    const segments = [...points.map((p, index) => [index === 0 ? "M" : "L", p[0], p[1]]), ["Z"]]
    g.save().alpha(0.18).path(segments, color).restore()
    g.path(segments, { stroke: color, width: 2 })
    points.forEach((p, index) => g.circle(p[0], p[1], index === active ? 4.5 : 2.5, color))
  })
  data.series.forEach((series, at) => {
    const item = box.legend[at]
    const hidden = state.hidden.includes(at)
    const color = series.color ?? PALETTE[at % PALETTE.length]
    g.circle(8 + 4, item.y, 4, hidden ? { stroke: color, width: 1.5 } : color)
    g.text(8 + 13, item.y + 4, fit(series.label, box.legendRight - 26, 12), {
      size: 12,
      color: hidden ? "muted" : "text",
    })
  })
  return g.commands
}

// Geometry shared by draw and tap: the center and radius, the scale's max and the legend rows on the left.
function layout(data, width, height) {
  const legendRight =
    data.series.length > 1 ? Math.min(140, 30 + 7 * Math.max(...data.series.map((series) => series.label.length))) : 0
  const r = Math.max(30, Math.min(height / 2 - 30, (width - legendRight) / 2 - 70))
  const top = data.max ?? Math.max(...data.series.flatMap((series) => series.values))
  const legend = data.series.length > 1 ? data.series.map((_, index) => ({ y: 14 + index * 20 })) : []
  return {
    cx: legendRight + (width - legendRight) / 2,
    cy: height / 2,
    r,
    max: data.max ?? nice(top),
    legend,
    legendRight,
  }
}

function nice(max) {
  if (max <= 0) return 1
  const power = Math.pow(10, Math.floor(Math.log10(max)))
  return power * ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((factor) => factor * power >= max) ?? 10)
}

// Axis 0 points up; the rest follow clockwise.
function point(box, index, n, r) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / n
  return [box.cx + Math.cos(angle) * r, box.cy + Math.sin(angle) * r]
}

function axisAt(data, box, px, py) {
  const distance = Math.hypot(px - box.cx, py - box.cy)
  if (distance > box.r + 40 || distance < 8) return null
  const n = data.axes.length
  const angle = Math.atan2(py - box.cy, px - box.cx) + Math.PI / 2
  return ((Math.round((angle / (Math.PI * 2)) * n) % n) + n) % n
}

function describe(state, data, index) {
  return (
    data.axes[index] +
    ": " +
    data.series
      .filter((_, at) => !state.hidden.includes(at))
      .map((series) => series.label + " " + amount(series.values[index], data.unit))
      .join(", ")
  )
}

function summary(data) {
  return (
    "Radar chart over " +
    data.axes.join(", ") +
    ". " +
    data.series
      .map((series) => series.label + ": " + series.values.map((value) => amount(value, data.unit)).join(", "))
      .join("; ")
  )
}

function amount(value, unit) {
  const text = String(Math.round((value ?? 0) * 100) / 100)
  if (!unit) return text
  return unit.length > 1 && /^[a-z]/i.test(unit) ? text + " " + unit : text + unit
}

function compact(value) {
  return String(Math.round(value * 100) / 100)
}

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
