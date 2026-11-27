// A bar or line chart drawn on a canvas. It animates in, then redraws only for pointer input: press (or drag) to read a
// value; with `choose`, tapping a bar or point submits it.

const HEIGHT = 240
const INTRO = 0.65
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"]

function init(data) {
  return { active: null, down: false }
}

function view(state, data) {
  const active = state.active && point(data, state.active)
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: state.down ? undefined : INTRO,
      alt: summary(data),
    }),
    ui.text(
      active
        ? active.label + " · " + active.series + ": " + amount(active.value, data.unit)
        : data.choose
          ? "Tap a " + (data.kind === "line" ? "point" : "bar") + " to choose it"
          : "Press a " + (data.kind === "line" ? "point" : "bar") + " to read its value",
      { style: "caption", tone: active ? "default" : "muted" },
    ),
  ])
}

function tap(state, data, pointer) {
  const hit = locate(data, layout(data, pointer.width, pointer.height), pointer.x, pointer.y)
  if (pointer.kind !== "up") return { active: hit ?? state.active, down: true }
  if (data.choose && hit) {
    const picked = point(data, hit)
    return submit({ series: picked.series, index: hit.index, value: picked.value })
  }
  return { active: hit, down: false }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(data, frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(data, box, frame.pointer.x, frame.pointer.y) : null
  const active = state.down || !hover ? state.active : hover
  axes(g, data, box)
  if (data.kind === "line") lines(g, data, box, frame.t, active)
  else bars(g, data, box, frame.t, active)
  if (data.series.length > 1) legend(g, data, box)
  if (active && frame.t >= INTRO) tooltip(g, data, box, active, frame.width)
  return g.commands
}

// Geometry shared by draw and tap: the plot area, the value range and the slots of each index.
function layout(data, width, height) {
  const count = Math.max(1, ...data.series.map((series) => series.values.length))
  const values = data.series.flatMap((series) => series.values)
  const range = nice(Math.min(0, ...values), Math.max(0, ...values))
  const left = 12 + 7 * Math.max(...range.ticks.map((tick) => compact(tick).length))
  const top = data.series.length > 1 ? 30 : 14
  const right = data.kind === "line" ? 20 : 12
  const plot = { x: left, y: top, w: Math.max(1, width - left - right), h: Math.max(1, height - top - 26) }
  const labels = []
  for (let index = 0; index < count; index++) labels.push(label(data, index))
  return { count, range, plot, slot: plot.w / count, labels }
}

// Rounds the range out to 1, 2, 2.5 or 5 times a power of ten, with 3 to 5 gridlines.
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

function y(box, value) {
  return box.plot.y + box.plot.h * (1 - (value - box.range.low) / (box.range.high - box.range.low))
}

function x(data, box, index) {
  if (data.kind !== "line") return box.plot.x + box.slot * (index + 0.5)
  return box.plot.x + (box.count === 1 ? box.plot.w / 2 : (box.plot.w * index) / (box.count - 1))
}

function bar(data, box, series, index) {
  const group = Math.min(box.slot * 0.72, 28 * data.series.length + 4 * (data.series.length - 1))
  const width = (group - 4 * (data.series.length - 1)) / data.series.length
  return { x: x(data, box, index) - group / 2 + series * (width + 4), w: width }
}

function locate(data, box, px, py) {
  if (
    px < box.plot.x - 8 ||
    px > box.plot.x + box.plot.w + 8 ||
    py < box.plot.y - 20 ||
    py > box.plot.y + box.plot.h + 8
  )
    return null
  const index =
    data.kind === "line"
      ? Math.round(((px - box.plot.x) / box.plot.w) * Math.max(1, box.count - 1))
      : Math.floor((px - box.plot.x) / box.slot)
  const clamped = Math.max(0, Math.min(box.count - 1, index))
  const candidates = data.series
    .map((series, at) => ({ series: at, value: series.values[clamped] }))
    .filter((candidate) => typeof candidate.value === "number")
  if (candidates.length === 0) return null
  const nearest = (score) =>
    candidates.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best)).series
  if (data.kind === "line") return { series: nearest((c) => Math.abs(y(box, c.value) - py)), index: clamped }
  return {
    series: nearest((c) => {
      const span = bar(data, box, c.series, clamped)
      return Math.abs(span.x + span.w / 2 - px)
    }),
    index: clamped,
  }
}

function axes(g, data, box) {
  const right = box.plot.x + box.plot.w
  for (const tick of box.range.ticks) {
    const at = y(box, tick)
    g.line(box.plot.x, at, right, at, { stroke: "border", width: tick === 0 ? 1.5 : 1 })
    g.text(box.plot.x - 8, at + 4, compact(tick), { size: 11, align: "right", color: "muted" })
  }
  const widest = Math.max(...box.labels.map((text) => text.length))
  const every = Math.max(1, Math.ceil((7 * widest + 12) / (box.plot.w / box.count)))
  for (let index = 0; index < box.count; index += every)
    g.text(x(data, box, index), box.plot.y + box.plot.h + 18, box.labels[index], {
      size: 11,
      align: "center",
      color: "muted",
    })
}

function bars(g, data, box, t, active) {
  const base = y(box, Math.max(box.range.low, 0))
  data.series.forEach((series, at) => {
    const fill = color(series, at)
    series.values.forEach((value, index) => {
      const grow = ease((t - (0.2 * index) / Math.max(1, box.count - 1)) / (INTRO - 0.2))
      if (grow <= 0) return
      const span = bar(data, box, at, index)
      const top = base + (y(box, value) - base) * grow
      const dim = active && (active.series !== at || active.index !== index)
      if (dim) g.save().alpha(0.45)
      g.rrect(span.x, Math.min(top, base), span.w, Math.max(1, Math.abs(base - top)), Math.min(4, span.w / 2), fill)
      if (dim) g.restore()
    })
  })
}

function lines(g, data, box, t, active) {
  const progress = ease(t / INTRO) * Math.max(1, box.count - 1)
  const base = y(box, Math.max(box.range.low, 0))
  if (active) g.line(x(data, box, active.index), box.plot.y, x(data, box, active.index), base, "border")
  data.series.forEach((series, at) => {
    const stroke = color(series, at)
    const points = series.values
      .map((value, index) => [x(data, box, index), y(box, value)])
      .filter((_, index) => index <= Math.ceil(progress))
    if (points.length === 0) return
    const last = Math.min(progress, series.values.length - 1)
    const whole = Math.floor(last)
    if (whole < points.length - 1) {
      const from = points[whole]
      const to = points[whole + 1]
      points[whole + 1] = [from[0] + (to[0] - from[0]) * (last - whole), from[1] + (to[1] - from[1]) * (last - whole)]
    }
    const segments = points.map((point, index) => [index === 0 ? "M" : "L", point[0], point[1]])
    const end = points[points.length - 1]
    if (data.series.length === 1 && points.length > 1)
      g.save()
        .alpha(0.12)
        .path([...segments, ["L", end[0], base], ["L", points[0][0], base], ["Z"]], stroke)
        .restore()
    g.path(segments, { stroke, width: 2.5, cap: "round" })
    points.forEach((point, index) => {
      if (index > last) return
      const on = active && active.series === at && active.index === index
      g.circle(point[0], point[1], on ? 5.5 : 3, { fill: on ? stroke : "bg", stroke, width: 2 })
    })
  })
}

function legend(g, data, box) {
  data.series.reduce((left, series, at) => {
    g.circle(left + 4, 12, 4, color(series, at))
    g.text(left + 13, 16, series.label, { size: 12, color: "muted" })
    return left + 30 + 7 * series.label.length
  }, box.plot.x)
}

function tooltip(g, data, box, active, width) {
  const picked = point(data, active)
  const title = picked.label
  const value = amount(picked.value, data.unit)
  const w = 20 + 7 * Math.max(title.length, value.length)
  const span = bar(data, box, active.series, active.index)
  const anchor = data.kind === "line" ? x(data, box, active.index) : span.x + span.w / 2
  const left = Math.max(2, Math.min(width - w - 2, anchor - w / 2))
  const top = Math.max(2, y(box, Math.max(picked.value, 0)) - 54)
  g.rrect(left, top, w, 44, 8, { fill: "surface", stroke: "border", width: 1 })
  g.text(left + 10, top + 17, title, { size: 11, color: "muted" })
  g.text(left + 10, top + 35, value, { size: 13, weight: 600, color: color(data.series[active.series], active.series) })
}

function point(data, active) {
  const series = data.series[active.series]
  return { series: series.label, label: label(data, active.index), value: series.values[active.index] }
}

function summary(data) {
  const kind = data.kind === "line" ? "Line chart" : "Bar chart"
  const series = data.series.map(
    (series) =>
      series.label +
      ": " +
      series.values
        .map((value, index) => (data.labels?.[index] ? data.labels[index] + " " : "") + amount(value, data.unit))
        .join(", "),
  )
  return kind + ". " + series.join("; ")
}

function label(data, index) {
  return data.labels?.[index] ?? String(index + 1)
}

function color(series, index) {
  return series.color ?? PALETTE[index % PALETTE.length]
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

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
