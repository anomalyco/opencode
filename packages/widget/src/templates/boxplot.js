// Box plots comparing distributions. Each group gives raw `values` (quartiles computed once in `init`, whiskers at the
// furthest values within 1.5 × IQR, the rest drawn as outliers) or precomputed `stats`. Boxes open out from the
// median; tap a box to read its statistics. With `choose`, the Choose button submits the selected group.

const HEIGHT = 260
const INTRO = 0.6
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

function init(data) {
  return {
    selected: null,
    stats: data.groups.map((group) =>
      group.stats ? { ...group.stats, outliers: group.stats.outliers ?? [] } : measure(group.values),
    ),
  }
}

function view(state, data) {
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: INTRO,
      alt: summary(state, data),
    }),
    ui.text(state.selected === null ? "Tap a box to read its statistics" : describe(state, data, state.selected), {
      style: "caption",
      tone: state.selected === null ? "muted" : "default",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose group", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: state.selected === null,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const { outliers, ...stats } = state.stats[state.selected]
    return submit({ label: data.groups[state.selected].label, index: state.selected, ...stats })
  }
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const hit = locate(data, layout(state, data, pointer.width, pointer.height), pointer.x, pointer.y)
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(state, data, frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(data, box, frame.pointer.x, frame.pointer.y) : null
  const active = hover ?? state.selected
  for (const tick of box.range.ticks) {
    const at = y(box, tick)
    g.line(box.plot.x, at, box.plot.x + box.plot.w, at, { stroke: "border", width: 1 })
    g.text(box.plot.x - 8, at + 4, compact(tick), { size: 11, align: "right", color: "muted" })
  }
  const grow = ease(frame.t / INTRO)
  data.groups.forEach((group, index) => {
    const stats = state.stats[index]
    const color = group.color ?? PALETTE[index % PALETTE.length]
    const cx = box.plot.x + box.slot * (index + 0.5)
    const half = Math.min(28, box.slot * 0.3)
    const median = y(box, stats.median)
    const at = (value) => median + (y(box, value) - median) * grow
    g.text(cx, box.plot.y + box.plot.h + 18, fit(group.label, box.slot - 4, 11), {
      size: 11,
      align: "center",
      weight: index === active ? 600 : 400,
      color: index === active ? "text" : "muted",
    })
    const dim = active !== null && active !== index
    if (dim) g.save().alpha(0.45)
    g.line(cx, at(stats.max), cx, at(stats.q3), { stroke: color, width: 1.5 })
    g.line(cx, at(stats.q1), cx, at(stats.min), { stroke: color, width: 1.5 })
    g.line(cx - half / 2, at(stats.max), cx + half / 2, at(stats.max), { stroke: color, width: 1.5 })
    g.line(cx - half / 2, at(stats.min), cx + half / 2, at(stats.min), { stroke: color, width: 1.5 })
    g.save()
      .alpha(dim ? 0.12 : 0.25)
      .rect(cx - half, at(stats.q3), half * 2, at(stats.q1) - at(stats.q3), color)
      .restore()
    g.rect(cx - half, at(stats.q3), half * 2, Math.max(1, at(stats.q1) - at(stats.q3)), {
      stroke: color,
      width: index === active ? 2.5 : 1.5,
    })
    g.line(cx - half, median, cx + half, median, { stroke: color, width: 3 })
    if (frame.t >= INTRO)
      for (const value of stats.outliers.slice(0, 40)) g.circle(cx, y(box, value), 3, { stroke: color, width: 1.5 })
    if (dim) g.restore()
  })
  return g.commands
}

// Quartiles by linear interpolation; whiskers at the furthest values within 1.5 × IQR of the box.
function measure(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const quantile = (q) => {
    const at = (n - 1) * q
    const low = Math.floor(at)
    return sorted[low] + (sorted[Math.min(n - 1, low + 1)] - sorted[low]) * (at - low)
  }
  const q1 = quantile(0.25)
  const q3 = quantile(0.75)
  const fence = 1.5 * (q3 - q1)
  const inside = sorted.filter((value) => value >= q1 - fence && value <= q3 + fence)
  const round = (value) => Math.round(value * 1e6) / 1e6
  return {
    n,
    min: inside[0],
    q1: round(q1),
    median: round(quantile(0.5)),
    q3: round(q3),
    max: inside[inside.length - 1],
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / n),
    outliers: sorted.filter((value) => value < q1 - fence || value > q3 + fence),
  }
}

function layout(state, data, width, height) {
  const all = state.stats.flatMap((stats) => [stats.min, stats.max, ...stats.outliers])
  const range = nice(Math.min(...all), Math.max(...all))
  const left = 14 + 7 * Math.max(...range.ticks.map((tick) => compact(tick).length))
  const plot = { x: left, y: 12, w: Math.max(1, width - left - 10), h: Math.max(1, height - 12 - 26) }
  return { plot, range, slot: plot.w / data.groups.length }
}

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

function locate(data, box, px, py) {
  if (px < box.plot.x || px > box.plot.x + box.plot.w || py < 0 || py > box.plot.y + box.plot.h + 24) return null
  return Math.max(0, Math.min(data.groups.length - 1, Math.floor((px - box.plot.x) / box.slot)))
}

function describe(state, data, index) {
  const stats = state.stats[index]
  const unit = data.unit
  return (
    data.groups[index].label +
    ": median " +
    amount(stats.median, unit) +
    ", IQR " +
    compact(stats.q1) +
    "–" +
    amount(stats.q3, unit) +
    ", whiskers " +
    compact(stats.min) +
    "–" +
    amount(stats.max, unit) +
    (stats.n !== undefined ? ", n = " + stats.n : "") +
    (stats.outliers.length
      ? ", " + stats.outliers.length + (stats.outliers.length === 1 ? " outlier" : " outliers")
      : "")
  )
}

function summary(state, data) {
  return "Box plots. " + data.groups.map((_, index) => describe(state, data, index)).join("; ")
}

function amount(value, unit) {
  const text = compact(value)
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

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
