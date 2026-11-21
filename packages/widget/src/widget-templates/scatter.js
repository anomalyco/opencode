// A scatter or bubble chart: points (x, y, optional size) in one or more series, with optional least-squares trend
// lines. Points pop in; press or drag to read the nearest point, tap a legend entry to hide its series. With `choose`,
// the Choose button submits the selected point.

const HEIGHT = 260
const INTRO = 0.7
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"]

function init(data) {
  return { active: null, down: false, hidden: [] }
}

function view(state, data) {
  const picked = state.active && data.series[state.active.series].points[state.active.index]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: state.down ? undefined : INTRO,
      alt: summary(data),
    }),
    ui.text(picked ? describe(data, state.active) : "Press a point to read it; tap a legend entry to hide a series", {
      style: "caption",
      tone: picked ? "default" : "muted",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose point", { onPress: (state) => choose(state, data), variant: "primary", disabled: !picked }),
      ]),
  ])
}

function choose(state, data) {
  if (state.active) {
    const point = data.series[state.active.series].points[state.active.index]
    return submit({ series: data.series[state.active.series].label, index: state.active.index, ...point })
  }
  return state
}

function tap(state, data, pointer) {
  const box = layout(data, state, pointer.width, pointer.height)
  const entry = legendAt(box, pointer.x, pointer.y)
  if (entry !== null) {
    if (pointer.kind !== "up") return state
    const hidden = state.hidden.includes(entry)
      ? state.hidden.filter((index) => index !== entry)
      : [...state.hidden, entry]
    return { active: state.active && state.active.series === entry ? null : state.active, down: false, hidden }
  }
  const hit = nearest(data, state, box, pointer.x, pointer.y)
  if (pointer.kind !== "up") return { ...state, active: hit ?? state.active, down: true }
  return { ...state, active: hit, down: false }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(data, state, frame.width, frame.height)
  const hover =
    frame.pointer && !frame.pointer.down ? nearest(data, state, box, frame.pointer.x, frame.pointer.y) : null
  const active = state.down || !hover ? state.active : hover
  axes(g, data, box)
  const count = data.series.reduce((sum, series) => sum + series.points.length, 0)
  let order = 0
  data.series.forEach((series, at) => {
    if (state.hidden.includes(at)) return void (order += series.points.length)
    const fill = color(series, at)
    if (data.trend && series.points.length > 1) trend(g, series, box, fill, frame.t)
    g.save().alpha(box.bubbles ? 0.55 : 0.85)
    series.points.forEach((point, index) => {
      const grow = ease((frame.t - (0.4 * order++) / Math.max(1, count)) / (INTRO - 0.4))
      if (grow > 0) g.circle(px(box, point.x), py(box, point.y), radius(box, point) * grow, fill)
    })
    g.restore()
  })
  if (data.series.length > 1) legend(g, data, state, box)
  if (active && frame.t >= INTRO) tooltip(g, data, box, active, frame.width)
  return g.commands
}

// Geometry shared by draw and tap: the plot area, both ranges and the bubble scale.
function layout(data, state, width, height) {
  const shown = data.series.filter((_, at) => !state.hidden.includes(at))
  const points = (shown.length ? shown : data.series).flatMap((series) => series.points)
  const xs = nice(Math.min(...points.map((point) => point.x)), Math.max(...points.map((point) => point.x)))
  const ys = nice(Math.min(...points.map((point) => point.y)), Math.max(...points.map((point) => point.y)))
  const sizes = data.series.flatMap((series) => series.points.map((point) => point.size ?? 0))
  const left = 14 + 7 * Math.max(...ys.ticks.map((tick) => compact(tick).length))
  const top = data.series.length > 1 || data.yLabel ? 34 : 14
  const plot = { x: left, y: top, w: Math.max(1, width - left - 16), h: Math.max(1, height - top - 40) }
  const legend = []
  let at = data.yLabel ? left + 14 + 7 * data.yLabel.length : left
  if (data.series.length > 1)
    for (const series of data.series) {
      legend.push({ x: at, to: at + 20 + 7 * series.label.length })
      at += 30 + 7 * series.label.length
    }
  return { plot, xs, ys, bubbles: Math.max(...sizes) > 0, maxSize: Math.max(1, ...sizes), legend }
}

function px(box, value) {
  return box.plot.x + (box.plot.w * (value - box.xs.low)) / (box.xs.high - box.xs.low)
}

function py(box, value) {
  return box.plot.y + box.plot.h * (1 - (value - box.ys.low) / (box.ys.high - box.ys.low))
}

function radius(box, point) {
  return box.bubbles ? 3 + 15 * Math.sqrt((point.size ?? 0) / box.maxSize) : 4
}

// The nearest visible point within 24 px of the pointer.
function nearest(data, state, box, x, y) {
  let best = null
  let distance = 24
  data.series.forEach((series, at) => {
    if (state.hidden.includes(at)) return
    series.points.forEach((point, index) => {
      const d = Math.hypot(px(box, point.x) - x, py(box, point.y) - y) - (box.bubbles ? radius(box, point) : 0)
      if (d < distance) {
        distance = d
        best = { series: at, index }
      }
    })
  })
  return best
}

// Rounds the range out to 1, 2, 2.5 or 5 times a power of ten, with 3 to 6 gridlines.
function nice(min, max) {
  const span = max - min || Math.abs(max) || 1
  const raw = span / 4
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = power * ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10)
  const low = Math.floor(min / step) * step
  const high = Math.max(low + step, Math.ceil(max / step) * step)
  const ticks = []
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Math.round(tick / step) * step)
  return { low, high, ticks }
}

function axes(g, data, box) {
  const bottom = box.plot.y + box.plot.h
  for (const tick of box.ys.ticks) {
    const at = py(box, tick)
    g.line(box.plot.x, at, box.plot.x + box.plot.w, at, { stroke: "border", width: 1 })
    g.text(box.plot.x - 8, at + 4, compact(tick), { size: 11, align: "right", color: "muted" })
  }
  for (const tick of box.xs.ticks) {
    const at = px(box, tick)
    g.line(at, box.plot.y, at, bottom, { stroke: "border", width: 1 })
    g.text(at, bottom + 16, compact(tick), { size: 11, align: "center", color: "muted" })
  }
  if (data.xLabel)
    g.text(box.plot.x + box.plot.w, bottom + 32, data.xLabel, { size: 11, align: "right", color: "muted" })
  if (data.yLabel) g.text(box.plot.x - 8, box.plot.y - 10, data.yLabel, { size: 11, color: "muted" })
}

// Least squares over the visible range of x, drawn left to right during the intro.
function trend(g, series, box, stroke, t) {
  const n = series.points.length
  const mx = series.points.reduce((sum, point) => sum + point.x, 0) / n
  const my = series.points.reduce((sum, point) => sum + point.y, 0) / n
  const sxx = series.points.reduce((sum, point) => sum + (point.x - mx) * (point.x - mx), 0)
  if (sxx === 0) return
  const slope = series.points.reduce((sum, point) => sum + (point.x - mx) * (point.y - my), 0) / sxx
  const xs = series.points.map((point) => point.x)
  const from = Math.min(...xs)
  const to = from + (Math.max(...xs) - from) * ease(t / INTRO)
  const at = (x) => [px(box, x), py(box, my + slope * (x - mx))]
  const [x1, y1] = at(from)
  const [x2, y2] = at(to)
  g.line(x1, y1, x2, y2, { stroke, width: 2, cap: "round" })
}

function legend(g, data, state, box) {
  const top = box.plot.y - 22
  data.series.forEach((series, at) => {
    const hidden = state.hidden.includes(at)
    const fill = color(series, at)
    const left = box.legend[at].x
    g.circle(left + 4, top, 4, hidden ? { stroke: fill, width: 1.5 } : fill)
    g.text(left + 13, top + 4, series.label, { size: 12, color: hidden ? "muted" : "text" })
  })
}

function legendAt(box, x, y) {
  if (box.legend.length === 0 || y > box.plot.y - 8) return null
  const index = box.legend.findIndex((entry) => x >= entry.x - 4 && x <= entry.to)
  return index < 0 ? null : index
}

function tooltip(g, data, box, active, width) {
  const series = data.series[active.series]
  const point = series.points[active.index]
  const title = point.label ?? series.label
  const value =
    compact(point.x) + ", " + compact(point.y) + (point.size !== undefined ? " · " + compact(point.size) : "")
  const w = 20 + 7 * Math.max(title.length, value.length)
  const x = px(box, point.x)
  const y = py(box, point.y)
  g.circle(x, y, radius(box, point) + 2, { stroke: "text", width: 2 })
  const left = Math.max(2, Math.min(width - w - 2, x - w / 2))
  const top = y - radius(box, point) - 52 < 2 ? y + radius(box, point) + 8 : y - radius(box, point) - 52
  g.rrect(left, top, w, 44, 8, { fill: "surface", stroke: "border", width: 1 })
  g.text(left + 10, top + 17, title, { size: 11, color: "muted" })
  g.text(left + 10, top + 35, value, { size: 13, weight: 600, color: color(series, active.series) })
}

function describe(data, active) {
  const series = data.series[active.series]
  const point = series.points[active.index]
  const name = point.label ? point.label + " (" + series.label + ")" : series.label
  const axes = (data.xLabel ?? "x") + " " + compact(point.x) + ", " + (data.yLabel ?? "y") + " " + compact(point.y)
  return name + " · " + axes + (point.size !== undefined ? ", size " + compact(point.size) : "")
}

function summary(data) {
  return (
    "Scatter chart" +
    (data.xLabel || data.yLabel ? " of " + (data.yLabel ?? "y") + " against " + (data.xLabel ?? "x") : "") +
    ". " +
    data.series
      .map(
        (series) =>
          series.label +
          ": " +
          series.points.length +
          " points, x " +
          compact(Math.min(...series.points.map((point) => point.x))) +
          " to " +
          compact(Math.max(...series.points.map((point) => point.x))) +
          ", y " +
          compact(Math.min(...series.points.map((point) => point.y))) +
          " to " +
          compact(Math.max(...series.points.map((point) => point.y))),
      )
      .join("; ")
  )
}

function color(series, index) {
  return series.color ?? PALETTE[index % PALETTE.length]
}

function compact(value) {
  const size = Math.abs(value)
  const round = (number) => String(Math.round(number * 10) / 10)
  if (size >= 1e9) return round(value / 1e9) + "B"
  if (size >= 1e6) return round(value / 1e6) + "M"
  if (size >= 1e4) return round(value / 1e3) + "k"
  return String(Math.round(value * 100) / 100)
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
