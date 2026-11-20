// A stacked area chart over time: "stacked" sums the series, "percent" shows each one's share and "stream" centers the
// stack around a middle baseline. Bands rise in; press or drag to read every series at a point in time and tap a
// legend entry to hide a series. With `choose`, the Choose button submits the selected series at that time.

const HEIGHT = 260
const INTRO = 0.7
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

function init(data) {
  return { active: null, down: false, hidden: [] }
}

function view(state, data) {
  const active = state.active
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
        ? label(data, active.index) +
            " · " +
            data.series[active.series].label +
            ": " +
            amount(data.series[active.series].values[active.index], data.unit)
        : "Press to read the values at a point in time; tap a legend entry to hide a series",
      { style: "caption", tone: active ? "default" : "muted" },
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose", { onPress: (state) => choose(state, data), variant: "primary", disabled: !active }),
      ]),
  ])
}

function choose(state, data) {
  if (state.active) {
    const series = data.series[state.active.series]
    return submit({
      series: series.label,
      index: state.active.index,
      label: label(data, state.active.index),
      value: series.values[state.active.index],
    })
  }
  return state
}

function tap(state, data, pointer) {
  const box = layout(data, state, pointer.width, pointer.height)
  const entry = box.legend.findIndex(
    (item) => pointer.y < box.plot.y - 6 && pointer.x >= item.x - 4 && pointer.x <= item.to,
  )
  if (entry >= 0) {
    if (pointer.kind !== "up") return state
    const hidden = state.hidden.includes(entry)
      ? state.hidden.filter((index) => index !== entry)
      : [...state.hidden, entry]
    if (hidden.length === data.series.length) return state
    return { active: null, down: false, hidden }
  }
  const hit = locate(data, state, box, pointer.x, pointer.y)
  if (pointer.kind !== "up") return { ...state, active: hit ?? state.active, down: true }
  return { ...state, active: hit, down: false }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(data, state, frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(data, state, box, frame.pointer.x, frame.pointer.y) : null
  const active = state.down || !hover ? state.active : hover
  const grow = ease(frame.t / INTRO)
  for (const tick of box.range.ticks) {
    const at = y(box, tick)
    g.line(box.plot.x, at, box.plot.x + box.plot.w, at, { stroke: "border", width: 1 })
    if (data.mode !== "stream")
      g.text(box.plot.x - 8, at + 4, compact(tick) + (data.mode === "percent" ? "%" : ""), {
        size: 11,
        align: "right",
        color: "muted",
      })
  }
  const every = Math.max(1, Math.ceil((7 * Math.max(...box.labels.map((text) => text.length)) + 12) / box.step))
  for (let index = 0; index < box.count; index += every)
    g.text(x(box, index), box.plot.y + box.plot.h + 18, box.labels[index], {
      size: 11,
      align: "center",
      color: "muted",
    })
  // Each band is its top edge forward and its bottom edge back, scaled toward the baseline while it rises in.
  const scale = (index, value) => y(box, box.base[index] + (value - box.base[index]) * grow)
  box.bands.forEach((band) => {
    const top = band.top.map((value, index) => ["L", x(box, index), scale(index, value)])
    const bottom = band.bottom.map((value, index) => ["L", x(box, index), scale(index, value)]).reverse()
    top[0][0] = "M"
    const dim = active && active.series !== band.series
    if (dim) g.save().alpha(0.4)
    g.path([...top, ...bottom, ["Z"]], { fill: band.color, stroke: "bg", width: 1 })
    if (dim) g.restore()
  })
  legend(g, data, state, box)
  if (active && frame.t >= INTRO) tooltip(g, data, box, active, frame.width)
  return g.commands
}

// Geometry shared by draw and tap: the plot, the stacked bands of the visible series and the y range.
function layout(data, state, width, height) {
  const count = Math.max(...data.series.map((series) => series.values.length))
  const shown = data.series
    .map((series, index) => ({ series, index }))
    .filter((item) => !state.hidden.includes(item.index))
  const totals = []
  for (let index = 0; index < count; index++)
    totals.push(shown.reduce((sum, item) => sum + Math.max(0, item.series.values[index] ?? 0), 0))
  const base = totals.map((total) => (data.mode === "stream" ? -total / 2 : 0))
  const cumulative = [...base]
  const bands = shown.map((item) => {
    const bottom = [...cumulative]
    const top = cumulative.map((value, index) => {
      const raw = Math.max(0, item.series.values[index] ?? 0)
      return value + (data.mode === "percent" ? (totals[index] ? (raw / totals[index]) * 100 : 0) : raw)
    })
    top.forEach((value, index) => (cumulative[index] = value))
    return { series: item.index, color: color(item.series, item.index), top, bottom }
  })
  const peak = Math.max(1, ...totals)
  const range =
    data.mode === "percent"
      ? { low: 0, high: 100, ticks: [0, 25, 50, 75, 100] }
      : data.mode === "stream"
        ? { low: -peak / 2, high: peak / 2, ticks: [-peak / 2, 0, peak / 2] }
        : nice(peak)
  const left = data.mode === "stream" ? 14 : 14 + 7 * Math.max(...range.ticks.map((tick) => compact(tick).length + 1))
  const plot = { x: left, y: 34, w: Math.max(1, width - left - 16), h: Math.max(1, height - 34 - 26) }
  const labels = []
  for (let index = 0; index < count; index++) labels.push(label(data, index))
  const legend = []
  let at = left
  for (const series of data.series) {
    legend.push({ x: at, to: at + 20 + 7 * series.label.length })
    at += 30 + 7 * series.label.length
  }
  return { count, plot, base, bands, range, labels, legend, step: plot.w / Math.max(1, count - 1) }
}

function nice(max) {
  const raw = max / 4
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = power * ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10)
  const high = Math.ceil(max / step) * step
  const ticks = []
  for (let tick = 0; tick <= high + step / 2; tick += step) ticks.push(Math.round(tick / step) * step)
  return { low: 0, high, ticks }
}

function x(box, index) {
  return box.plot.x + box.step * index
}

function y(box, value) {
  return box.plot.y + box.plot.h * (1 - (value - box.range.low) / (box.range.high - box.range.low))
}

// The time index nearest the pointer and the band under it (or the nearest band).
function locate(data, state, box, px, py) {
  if (
    px < box.plot.x - 8 ||
    px > box.plot.x + box.plot.w + 8 ||
    py < box.plot.y - 4 ||
    py > box.plot.y + box.plot.h + 8
  )
    return null
  if (box.bands.length === 0) return null
  const index = Math.max(0, Math.min(box.count - 1, Math.round((px - box.plot.x) / box.step)))
  const value = box.range.low + (1 - (py - box.plot.y) / box.plot.h) * (box.range.high - box.range.low)
  const band =
    box.bands.find((band) => value >= band.bottom[index] && value <= band.top[index]) ??
    (value > box.bands[box.bands.length - 1].top[index] ? box.bands[box.bands.length - 1] : box.bands[0])
  return { series: band.series, index }
}

function legend(g, data, state, box) {
  data.series.forEach((series, index) => {
    const hidden = state.hidden.includes(index)
    const fill = color(series, index)
    const left = box.legend[index].x
    g.circle(left + 4, 12, 4, hidden ? { stroke: fill, width: 1.5 } : fill)
    g.text(left + 13, 16, series.label, { size: 12, color: hidden ? "muted" : "text" })
  })
}

// A crosshair and a box listing every visible series at the active time, top band first.
function tooltip(g, data, box, active, width) {
  const at = x(box, active.index)
  g.line(at, box.plot.y, at, box.plot.y + box.plot.h, { stroke: "text", width: 1 })
  const rows = [...box.bands].reverse().map((band) => ({
    band,
    text: data.series[band.series].label + "  " + amount(data.series[band.series].values[active.index] ?? 0, data.unit),
  }))
  const w = 34 + 7 * Math.max(box.labels[active.index].length, ...rows.map((row) => row.text.length))
  const h = 28 + 18 * rows.length
  const left = at + 12 + w > width - 2 ? at - 12 - w : at + 12
  const top = box.plot.y + 4
  g.rrect(left, top, w, h, 8, { fill: "surface", stroke: "border", width: 1 })
  g.text(left + 10, top + 17, box.labels[active.index], { size: 11, color: "muted" })
  rows.forEach((row, index) => {
    const line = top + 36 + 18 * index
    g.circle(left + 14, line - 4, 4, row.band.color)
    g.text(left + 24, line, row.text, { size: 12, weight: row.band.series === active.series ? 600 : 400 })
  })
}

function summary(data) {
  const kind =
    data.mode === "percent" ? "Percent stacked area" : data.mode === "stream" ? "Streamgraph" : "Stacked area"
  return (
    kind +
    " chart" +
    (data.labels ? " from " + data.labels[0] + " to " + data.labels[data.labels.length - 1] : "") +
    ". " +
    data.series
      .map(
        (series) =>
          series.label +
          ": " +
          amount(series.values[0], data.unit) +
          " to " +
          amount(series.values[series.values.length - 1], data.unit) +
          ", peak " +
          amount(Math.max(...series.values), data.unit),
      )
      .join("; ")
  )
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
