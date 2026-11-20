// A histogram of raw values. `init` sorts the values once and picks bins (Freedman–Diaconis, rounded to a nice width,
// or `bins` of them), so draws only scale bars. Press or drag to read a bin; the median is marked. With `choose`, the
// Choose button submits the selected bin.

const HEIGHT = 240
const INTRO = 0.65

function init(data) {
  const sorted = [...data.values].sort((a, b) => a - b)
  return { active: null, down: false, ...bin(sorted, data.bins) }
}

function view(state, data) {
  const picked = state.active === null ? null : state.bins[state.active]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: state.down ? undefined : INTRO,
      alt: summary(state, data),
    }),
    ui.text(
      picked
        ? range(picked, data.unit) +
            ": " +
            picked.count +
            (picked.count === 1 ? " value" : " values") +
            " (" +
            Math.round((picked.count / state.stats.n) * 1000) / 10 +
            "%)"
        : "n = " +
            state.stats.n +
            " · median " +
            amount(state.stats.median, data.unit) +
            " · mean " +
            amount(state.stats.mean, data.unit),
      { style: "caption", tone: picked ? "default" : "muted" },
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose bin", { onPress: (state) => choose(state, data), variant: "primary", disabled: !picked }),
      ]),
  ])
}

function choose(state, data) {
  if (state.active !== null) {
    const picked = state.bins[state.active]
    return submit({ index: state.active, from: picked.from, to: picked.to, count: picked.count })
  }
  return state
}

function tap(state, data, pointer) {
  const hit = locate(state, layout(state, data, pointer.width, pointer.height), pointer.x, pointer.y)
  if (pointer.kind !== "up") return { ...state, active: hit ?? state.active, down: true }
  return { ...state, active: hit, down: false }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const box = layout(state, data, frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(state, box, frame.pointer.x, frame.pointer.y) : null
  const active = state.down || hover === null ? state.active : hover
  const bottom = box.plot.y + box.plot.h
  for (const tick of box.counts.ticks) {
    const at = y(box, tick)
    g.line(box.plot.x, at, box.plot.x + box.plot.w, at, { stroke: "border", width: tick === 0 ? 1.5 : 1 })
    g.text(box.plot.x - 8, at + 4, String(tick), { size: 11, align: "right", color: "muted" })
  }
  const every = Math.max(1, Math.ceil((7 * 6 + 8) / box.slot))
  for (let index = 0; index <= state.bins.length; index += every) {
    const edge = index < state.bins.length ? state.bins[index].from : state.bins[index - 1].to
    g.text(box.plot.x + box.slot * index, bottom + 16, compact(edge), { size: 11, align: "center", color: "muted" })
  }
  if (data.label) g.text(box.plot.x + box.plot.w, bottom + 32, data.label, { size: 11, align: "right", color: "muted" })
  state.bins.forEach((item, index) => {
    const grow = ease((frame.t - (0.25 * index) / state.bins.length) / (INTRO - 0.25))
    if (grow <= 0 || item.count === 0) return
    const top = bottom - (bottom - y(box, item.count)) * grow
    const dim = active !== null && active !== index
    if (dim) g.save().alpha(0.45)
    g.rrect(
      box.plot.x + box.slot * index + 1,
      top,
      Math.max(1, box.slot - 2),
      bottom - top,
      Math.min(3, box.slot / 4),
      {
        fill: data.color ?? "accent",
      },
    )
    if (dim) g.restore()
  })
  if (frame.t >= INTRO) {
    const median = box.plot.x + (box.plot.w * (state.stats.median - box.low)) / (box.high - box.low)
    g.line(median, box.plot.y - 4, median, bottom, { stroke: "text", width: 1.5 })
    g.text(median + 4, box.plot.y + 6, "median", { size: 10, color: "muted" })
  }
  if (active !== null && frame.t >= INTRO) tooltip(g, state, data, box, active, frame.width)
  return g.commands
}

// Bins of a nice width covering the sorted values, with summary stats.
function bin(sorted, bins) {
  const n = sorted.length
  const min = sorted[0]
  const max = sorted[n - 1]
  const quantile = (q) => {
    const at = (n - 1) * q
    const low = Math.floor(at)
    return sorted[low] + (sorted[Math.min(n - 1, low + 1)] - sorted[low]) * (at - low)
  }
  const span = max - min || 1
  const fd = 2 * (quantile(0.75) - quantile(0.25)) * Math.pow(n, -1 / 3)
  const target = bins ?? Math.max(5, Math.min(40, fd > 0 ? Math.ceil(span / fd) : Math.ceil(Math.log2(n)) + 1))
  const raw = span / target
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const width = bins ? raw : power * ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10)
  const start = bins ? min : Math.floor(min / width) * width
  const count = Math.max(1, bins ?? Math.ceil((max - start) / width - 1e-9))
  const result = []
  for (let index = 0; index < count; index++)
    result.push({ from: round(start + width * index), to: round(start + width * (index + 1)), count: 0 })
  for (const value of sorted) result[Math.min(count - 1, Math.floor((value - start) / width))].count++
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n
  return { bins: result, stats: { n, min, max, mean, median: quantile(0.5) } }
}

// Geometry shared by draw and tap.
function layout(state, data, width, height) {
  const counts = nice(Math.max(...state.bins.map((item) => item.count)))
  const left = 14 + 7 * String(counts.high).length
  const plot = {
    x: left,
    y: 14,
    w: Math.max(1, width - left - 14),
    h: Math.max(1, height - 14 - (data.label ? 40 : 26)),
  }
  const low = state.bins[0].from
  const high = state.bins[state.bins.length - 1].to
  return { plot, counts, low, high, slot: plot.w / state.bins.length }
}

function nice(max) {
  const raw = Math.max(1, max) / 4
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = Math.max(1, power * ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10))
  const high = Math.max(step, Math.ceil(max / step) * step)
  const ticks = []
  for (let tick = 0; tick <= high + step / 2; tick += step) ticks.push(Math.round(tick))
  return { high, ticks }
}

function y(box, count) {
  return box.plot.y + box.plot.h * (1 - count / box.counts.high)
}

function locate(state, box, px, py) {
  if (px < box.plot.x || px > box.plot.x + box.plot.w || py < box.plot.y - 10 || py > box.plot.y + box.plot.h + 8)
    return null
  return Math.max(0, Math.min(state.bins.length - 1, Math.floor((px - box.plot.x) / box.slot)))
}

function tooltip(g, state, data, box, index, width) {
  const item = state.bins[index]
  const title = range(item, data.unit)
  const value = item.count + (item.count === 1 ? " value" : " values")
  const w = 20 + 7 * Math.max(title.length, value.length)
  const left = Math.max(2, Math.min(width - w - 2, box.plot.x + box.slot * (index + 0.5) - w / 2))
  const top = Math.max(2, y(box, item.count) - 54)
  g.rrect(left, top, w, 44, 8, { fill: "surface", stroke: "border", width: 1 })
  g.text(left + 10, top + 17, title, { size: 11, color: "muted" })
  g.text(left + 10, top + 35, value, { size: 13, weight: 600 })
}

function range(item, unit) {
  return compact(item.from) + "–" + amount(item.to, unit)
}

function summary(state, data) {
  return (
    "Histogram of " +
    state.stats.n +
    " values from " +
    amount(state.stats.min, data.unit) +
    " to " +
    amount(state.stats.max, data.unit) +
    ", median " +
    amount(state.stats.median, data.unit) +
    ". Bins: " +
    state.bins.map((item) => range(item, data.unit) + " " + item.count).join(", ")
  )
}

function round(value) {
  return Math.round(value * 1e6) / 1e6
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

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
