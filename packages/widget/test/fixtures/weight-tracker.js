// Weight and calorie tracker on widget.storage: one key per entry ("entry:<ISO time>:<random>"), so entries logged on
// two devices never overwrite each other. Native inputs log a meal or a weight, a select picks the week or the month,
// and a 2D canvas charts the history: each day's calories as bars, the weight as a line, press or drag to read a day.
// The chart's drawing is the built-in `chart` template's (widget-templates/chart.js), with a second value axis for the
// weight, run from a live program: it animates in on frames, then redraws on pointer input and storage changes. Days
// are UTC days, so every device shows the same history.

const HEIGHT = 240
const INTRO = 0.65
const DAY = 86400000
const KCAL = "#f59e0b"
const KG = "accent"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

async function main(data) {
  const s = {
    range: "week",
    kcal: "",
    kg: "",
    note: null,
    logged: 0,
    active: null,
    down: false,
    width: 0,
    t: INTRO,
    intro: 0,
  }
  const entries = () =>
    widget.storage
      .keys("entry:")
      .map((key) => ({ key, ...widget.storage.get(key) }))
      .filter((entry) => typeof entry.at === "string")
  const days = () => history(entries(), s.range === "week" ? 7 : 30)
  const paint = () => {
    if (s.width > 0) widget.draw("chart", chart(days(), s.width, s.t, s.active))
  }
  // Animates the chart in over INTRO seconds on display frames, which also give its width; a newer intro stops it.
  const intro = async () => {
    const run = ++s.intro
    const start = widget.now()
    s.t = 0
    while (s.t < INTRO && run === s.intro) {
      const frame = await widget.frame()
      if (run !== s.intro) return
      s.width = frame.width
      s.t = Math.min(INTRO, (widget.now() - start) / 1000)
      paint()
    }
  }
  const log = async (field, text, low, high, unit) => {
    const value = Number(String(text).replace(",", "."))
    if (!(value >= low && value <= high)) {
      s.note = "Enter " + (field === "kcal" ? "calories" : "a weight") + " from " + low + " to " + high + " " + unit
      return view()
    }
    const at = new Date().toISOString()
    s[field] = ""
    s.logged++
    s.note = "Logged " + value + " " + unit
    await widget.storage.set("entry:" + at + ":" + Math.random().toString(36).slice(2, 6), { at, [field]: value })
    view()
  }
  const remove = async (key) => {
    await widget.storage.delete(key)
    view()
  }
  const onPointer = (pointer) => {
    if (pointer.kind === "wheel") return
    s.width = pointer.width
    const list = days()
    const hit = locate(layout(list, pointer.width), pointer.x, pointer.y)
    if (pointer.kind !== "up") {
      s.active = hit ?? s.active
      s.down = true
    } else {
      s.active = hit
      s.down = false
    }
    view()
  }
  const view = () => {
    const all = entries()
    const list = days()
    const today = list[list.length - 1]
    const weights = all.filter((entry) => entry.kg !== undefined)
    const active = s.active === null ? null : list[s.active]
    widget.render(
      ui.column({ gap: 2, align: "stretch" }, [
        ui.text(data.title ?? "Weight & calories", { style: "title" }),
        ui.text(
          "Today " +
            today.kcal +
            " kcal · " +
            (weights.length ? weights[weights.length - 1].kg + " kg" : "no weight yet") +
            " · " +
            all.length +
            " entries",
        ),
        ui.row({ gap: 1 }, [
          // Typing only keeps the text: a render per keystroke would send back a value behind what was typed. A new
          // key after each entry gives an empty input.
          ui.input(s.kcal, {
            key: "kcal" + s.logged,
            placeholder: "Calories (kcal)",
            onChange: (value) => (s.kcal = value),
          }),
          ui.button("Log meal", { variant: "primary", onPress: () => log("kcal", s.kcal, 1, 9999, "kcal") }),
        ]),
        ui.row({ gap: 1 }, [
          ui.input(s.kg, { key: "kg" + s.logged, placeholder: "Weight (kg)", onChange: (value) => (s.kg = value) }),
          ui.button("Log weight", { variant: "primary", onPress: () => log("kg", s.kg, 20, 400, "kg") }),
        ]),
        s.note && ui.text(s.note, { style: "caption", tone: s.note.startsWith("Logged") ? "success" : "warning" }),
        ui.select(
          [
            { value: "week", label: "Last 7 days" },
            { value: "month", label: "Last 30 days" },
          ],
          {
            value: s.range,
            onChange: (value) => {
              s.range = value
              s.active = null
              view()
              intro()
            },
          },
        ),
        ui.canvas({ key: "chart", height: HEIGHT, alt: summary(list), onPointer }),
        ui.text(
          active
            ? label(active.day) + ": " + active.kcal + " kcal" + (active.kg === null ? "" : " · " + active.kg + " kg")
            : "Press or drag the chart to read a day",
          { style: "caption", tone: active ? "default" : "muted" },
        ),
        ui.divider(),
        ui.text("Recent entries", { style: "caption", tone: "muted" }),
        all
          .slice(-5)
          .reverse()
          .map((entry) =>
            ui.row({ key: entry.key, gap: 1 }, [
              ui.text(
                entry.at.slice(5, 16).replace("T", " ") + "  " + (entry.kcal ? entry.kcal + " kcal" : entry.kg + " kg"),
              ),
              ui.button("Delete", { variant: "secondary", onPress: () => remove(entry.key) }),
            ]),
          ),
      ]),
    )
    paint()
  }
  widget.on("storage", () => view())
  widget.on("resumed", () => view())
  view()
  await intro()
}

// The last `count` UTC days up to today: each day's calories, and its last weight (null without one).
function history(entries, count) {
  const today = Math.floor(Date.now() / DAY)
  const days = []
  for (let index = count - 1; index >= 0; index--)
    days.push({ day: new Date((today - index) * DAY).toISOString().slice(0, 10), kcal: 0, kg: null })
  const byDay = new Map(days.map((day) => [day.day, day]))
  for (const entry of entries) {
    const day = byDay.get(entry.at.slice(0, 10))
    if (!day) continue
    if (entry.kcal !== undefined) day.kcal += entry.kcal
    if (entry.kg !== undefined) day.kg = entry.kg
  }
  return days
}

function label(day) {
  return MONTHS[Number(day.slice(5, 7)) - 1] + " " + Number(day.slice(8, 10))
}

function chart(days, width, t, active) {
  const g = ui.draw()
  const box = layout(days, width)
  axes(g, box)
  bars(g, box, days, t, active)
  line(g, box, days, t, active)
  legend(g, box)
  if (active !== null && t >= INTRO) tooltip(g, box, days[active], active, width)
  return g
}

// From chart.js: the plot area, the value ranges (calories on the left, weight on the right) and each day's slot.
function layout(days, width) {
  const count = days.length
  const kcal = nice(0, Math.max(500, ...days.map((day) => day.kcal)))
  const weights = days.filter((day) => day.kg !== null).map((day) => day.kg)
  const kg = weights.length ? nice(Math.min(...weights) - 0.5, Math.max(...weights) + 0.5) : nice(70, 90)
  const left = 12 + 7 * Math.max(...kcal.ticks.map((tick) => compact(tick).length))
  const right = 12 + 7 * Math.max(...kg.ticks.map((tick) => compact(tick).length))
  const plot = { x: left, y: 30, w: Math.max(1, width - left - right), h: Math.max(1, HEIGHT - 30 - 26) }
  return { count, kcal, kg, plot, slot: plot.w / count, labels: days.map((day) => label(day.day)) }
}

// From chart.js: rounds the range out to 1, 2, 2.5 or 5 times a power of ten, with 3 to 5 gridlines.
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

function y(box, range, value) {
  return box.plot.y + box.plot.h * (1 - (value - range.low) / (range.high - range.low))
}

function x(box, index) {
  return box.plot.x + box.slot * (index + 0.5)
}

function locate(box, px, py) {
  if (
    px < box.plot.x - 8 ||
    px > box.plot.x + box.plot.w + 8 ||
    py < box.plot.y - 20 ||
    py > box.plot.y + box.plot.h + 8
  )
    return null
  return Math.max(0, Math.min(box.count - 1, Math.floor((px - box.plot.x) / box.slot)))
}

function axes(g, box) {
  const right = box.plot.x + box.plot.w
  for (const tick of box.kcal.ticks) {
    const at = y(box, box.kcal, tick)
    g.line(box.plot.x, at, right, at, { stroke: "border", width: tick === 0 ? 1.5 : 1 })
    g.text(box.plot.x - 8, at + 4, compact(tick), { size: 11, align: "right", color: "muted" })
  }
  for (const tick of box.kg.ticks)
    g.text(right + 8, y(box, box.kg, tick) + 4, compact(tick), { size: 11, color: "muted" })
  const widest = Math.max(...box.labels.map((text) => text.length))
  const every = Math.max(1, Math.ceil((7 * widest + 12) / (box.plot.w / box.count)))
  for (let index = box.count - 1; index >= 0; index -= every)
    g.text(x(box, index), box.plot.y + box.plot.h + 18, box.labels[index], {
      size: 11,
      align: "center",
      color: "muted",
    })
}

// From chart.js: bars grow in one after another; the others dim while a day is read.
function bars(g, box, days, t, active) {
  const base = y(box, box.kcal, 0)
  const w = Math.min(box.slot * 0.72, 28)
  days.forEach((day, index) => {
    if (day.kcal === 0) return
    const grow = ease((t - (0.2 * index) / Math.max(1, box.count - 1)) / (INTRO - 0.2))
    if (grow <= 0) return
    const top = base + (y(box, box.kcal, day.kcal) - base) * grow
    const dim = active !== null && active !== index
    if (dim) g.save().alpha(0.45)
    g.rrect(x(box, index) - w / 2, top, w, Math.max(1, base - top), Math.min(4, w / 2), KCAL)
    if (dim) g.restore()
  })
}

// From chart.js: the line draws in from the left through the days that have a weight.
function line(g, box, days, t, active) {
  const progress = ease(t / INTRO) * Math.max(1, box.count - 1)
  if (active !== null) g.line(x(box, active), box.plot.y, x(box, active), box.plot.y + box.plot.h, "border")
  const all = days.flatMap((day, index) => (day.kg === null ? [] : [[index, x(box, index), y(box, box.kg, day.kg)]]))
  const points = all.filter((point) => point[0] <= progress).map((point) => [point[1], point[2]])
  const next = all.find((point) => point[0] > progress)
  const last = all.filter((point) => point[0] <= progress).pop()
  if (last && next) {
    const part = (progress - last[0]) / (next[0] - last[0])
    points.push([last[1] + (next[1] - last[1]) * part, last[2] + (next[2] - last[2]) * part])
  }
  if (points.length > 1)
    g.path(
      points.map((point, index) => [index === 0 ? "M" : "L", point[0], point[1]]),
      { stroke: KG, width: 2.5, cap: "round" },
    )
  all.forEach((point) => {
    if (point[0] > progress) return
    const on = active === point[0]
    g.circle(point[1], point[2], on ? 5.5 : 3, { fill: on ? KG : "bg", stroke: KG, width: 2 })
  })
}

// From chart.js.
function legend(g, box) {
  ;[
    ["kcal", KCAL],
    ["kg", KG],
  ].reduce((left, [text, color]) => {
    g.circle(left + 4, 12, 4, color)
    g.text(left + 13, 16, text, { size: 12, color: "muted" })
    return left + 30 + 7 * text.length
  }, box.plot.x)
}

// From chart.js, with both of the day's values.
function tooltip(g, box, day, index, width) {
  const title = label(day.day)
  const kcal = day.kcal + " kcal"
  const kg = day.kg === null ? "no weight" : day.kg + " kg"
  const w = 20 + 7 * Math.max(title.length, kcal.length, kg.length)
  const left = Math.max(2, Math.min(width - w - 2, x(box, index) - w / 2))
  const top = box.plot.y + 4
  g.rrect(left, top, w, 62, 8, { fill: "surface", stroke: "border", width: 1 })
  g.text(left + 10, top + 17, title, { size: 11, color: "muted" })
  g.text(left + 10, top + 35, kcal, { size: 13, weight: 600, color: KCAL })
  g.text(left + 10, top + 53, kg, { size: 13, weight: 600, color: KG })
}

function summary(days) {
  return (
    "Chart of the last " +
    days.length +
    " days. " +
    days
      .map((day) => label(day.day) + " " + day.kcal + " kcal" + (day.kg === null ? "" : " " + day.kg + " kg"))
      .join(", ")
  )
}

// From chart.js.
function compact(value) {
  const size = Math.abs(value)
  const round = (number) => String(Math.round(number * 10) / 10)
  if (size >= 1e9) return round(value / 1e9) + "B"
  if (size >= 1e6) return round(value / 1e6) + "M"
  if (size >= 1e4) return round(value / 1e3) + "k"
  return String(Math.round(value * 100) / 100)
}

// From chart.js.
function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
