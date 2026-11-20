// KPI dials: one to four gauges side by side, each a 270° arc from min to max with optional threshold bands (each band
// runs up to `to` in a tone) and a target tick. The value arc takes the tone of its band and sweeps in while the
// number counts up. Tap a gauge to select it. With `choose`, the Choose button submits the selected gauge.

const HEIGHT = 190
const INTRO = 0.9
const START = (Math.PI * 3) / 4
const SWEEP = (Math.PI * 3) / 2

function init(data) {
  return { selected: null }
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
    ui.text(state.selected === null ? "Tap a gauge for its thresholds" : describe(data.gauges[state.selected]), {
      style: "caption",
      tone: state.selected === null ? "muted" : "default",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose gauge", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: state.selected === null,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const gauge = data.gauges[state.selected]
    return submit({ label: gauge.label, index: state.selected, value: gauge.value, tone: tone(gauge, gauge.value) })
  }
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const index = Math.floor((pointer.x / pointer.width) * data.gauges.length)
  const hit = index >= 0 && index < data.gauges.length ? index : null
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const cell = frame.width / data.gauges.length
  const r = Math.max(24, Math.min(cell / 2 - 18, 74))
  // The dial, its min/max and its label are 1.71 r + 54 px tall; center them vertically.
  const top = Math.max(10, (frame.height - 1.71 * r - 54) / 2)
  const grow = ease(frame.t / INTRO)
  data.gauges.forEach((gauge, index) => {
    const cx = cell * (index + 0.5)
    const cy = top + r
    const min = gauge.min ?? 0
    const at = (value) => START + SWEEP * Math.max(0, Math.min(1, (value - min) / (gauge.max - min || 1)))
    if (index === state.selected)
      g.rrect(cx - cell / 2 + 4, 2, cell - 8, frame.height - 4, 10, { fill: "surface", stroke: "border", width: 1 })
    g.path(arc(cx, cy, r, START, START + SWEEP), { stroke: "border", width: 10, cap: "round" })
    let from = min
    g.save().alpha(0.45)
    for (const band of [...(gauge.bands ?? [])].sort((a, b) => a.to - b.to)) {
      if (band.to > from)
        g.path(arc(cx, cy, r + 9, at(from), at(Math.min(band.to, gauge.max))), { stroke: band.tone, width: 3 })
      from = band.to
    }
    g.restore()
    const shown = min + (gauge.value - min) * grow
    if (shown > min)
      g.path(arc(cx, cy, r, START, at(shown)), { stroke: tone(gauge, gauge.value), width: 10, cap: "round" })
    if (gauge.target !== undefined) {
      const angle = at(gauge.target)
      g.line(
        cx + Math.cos(angle) * (r - 9),
        cy + Math.sin(angle) * (r - 9),
        cx + Math.cos(angle) * (r + 9),
        cy + Math.sin(angle) * (r + 9),
        {
          stroke: "text",
          width: 2,
          cap: "round",
        },
      )
    }
    g.text(cx, cy + 8, amount(shown, gauge.unit, gauge.value), {
      size: Math.min(24, r / 2.6),
      weight: 700,
      align: "center",
    })
    g.text(cx - r * 0.71, cy + r * 0.71 + 16, compact(min), { size: 10, align: "center", color: "muted" })
    g.text(cx + r * 0.71, cy + r * 0.71 + 16, compact(gauge.max), { size: 10, align: "center", color: "muted" })
    g.text(cx, cy + r * 0.71 + 36, fit(gauge.label, cell - 16, 13), { size: 13, weight: 600, align: "center" })
  })
  return g.commands
}

// The band's tone for a value: the first band whose `to` is at or above it (default accent).
function tone(gauge, value) {
  const band = [...(gauge.bands ?? [])].sort((a, b) => a.to - b.to).find((band) => value <= band.to)
  return band?.tone ?? "accent"
}

function arc(cx, cy, r, from, to) {
  const segments = [["M", cx + Math.cos(from) * r, cy + Math.sin(from) * r]]
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
  return segments
}

function describe(gauge) {
  const bands = [...(gauge.bands ?? [])].sort((a, b) => a.to - b.to)
  const band = bands.findIndex((band) => gauge.value <= band.to)
  return (
    gauge.label +
    ": " +
    amount(gauge.value, gauge.unit) +
    " of " +
    compact(gauge.min ?? 0) +
    "–" +
    compact(gauge.max) +
    (band >= 0
      ? " · " +
        bands[band].tone +
        " band (" +
        compact(band ? bands[band - 1].to : (gauge.min ?? 0)) +
        "–" +
        compact(bands[band].to) +
        ")"
      : "") +
    (gauge.target !== undefined ? " · target " + amount(gauge.target, gauge.unit) : "")
  )
}

function summary(data) {
  return "Gauges. " + data.gauges.map(describe).join("; ")
}

// While counting up, show as many decimals as the final value has (at most two).
function amount(value, unit, final) {
  const digits = Math.min(2, (String(final ?? value).split(".")[1] ?? "").length)
  const text = (Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits)).toFixed(digits)
  if (!unit) return text
  return unit.length > 1 && /^[a-z]/i.test(unit) ? text + " " + unit : text + unit
}

function compact(value) {
  const size = Math.abs(value)
  if (size >= 1e6) return Math.round(value / 1e5) / 10 + "M"
  if (size >= 1e4) return Math.round(value / 100) / 10 + "k"
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
