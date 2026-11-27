// Weight and calorie tracker on widget.storage: one key per entry ("entry:<ISO time>:<random>"), so entries logged on
// two devices never overwrite each other, and a chart of the history (weight as a line, each day's calories as bars;
// tap or drag to inspect a day; a week or month range). Days are UTC days, so every device shows the same history.
const CHART = 200
const DAY = 86400000
const PAD = { left: 36, right: 40, top: 14, bottom: 24 }

async function main(data) {
  const ui$ = { kcal: 500, kg: 80, range: 7, picked: null, width: 0 }
  const entries = () =>
    widget.storage
      .keys("entry:")
      .map((key) => ({ key, ...widget.storage.get(key) }))
      .filter((entry) => typeof entry.at === "string")
  const log = async (entry) => {
    const at = new Date().toISOString()
    await widget.storage.set("entry:" + at + ":" + Math.random().toString(36).slice(2, 6), { at, ...entry })
    show()
  }
  const remove = async (key) => {
    await widget.storage.delete(key)
    show()
  }
  const range = (days) => {
    ui$.range = days
    ui$.picked = null
    show()
  }
  const onPointer = (pointer) => {
    if (pointer.kind === "wheel") return
    ui$.width = pointer.width
    const days = history(entries(), ui$.range)
    const slot = (pointer.width - PAD.left - PAD.right) / days.length
    const index = Math.floor((pointer.x - PAD.left) / slot)
    ui$.picked = index >= 0 && index < days.length ? days[index].day : ui$.picked
    widget.draw("chart", chart(days, ui$))
    render(days)
  }
  const render = (days) => {
    const all = entries()
    const today = days[days.length - 1]
    const picked = days.find((day) => day.day === ui$.picked)
    const weights = all.filter((entry) => entry.kg !== undefined)
    const last = weights.length ? weights[weights.length - 1].kg + " kg" : "no weight yet"
    widget.render(
      ui.column({ gap: 2, align: "stretch" }, [
        ui.text(data.title ?? "Weight & calories", { style: "title" }),
        ui.text("Today: " + today.kcal + " kcal · " + last + " · " + all.length + " entries"),
        ui.row({ gap: 1 }, [
          ui.button("Week", { variant: ui$.range === 7 ? "primary" : "secondary", onPress: () => range(7) }),
          ui.button("Month", { variant: ui$.range === 30 ? "primary" : "secondary", onPress: () => range(30) }),
        ]),
        ui.canvas({
          key: "chart",
          height: CHART,
          alt: "Chart: weight as a line and daily calories as bars over the last " + ui$.range + " days",
          onPointer,
        }),
        ui.text(
          picked
            ? label(picked.day) + ": " + picked.kcal + " kcal" + (picked.kg === null ? "" : " · " + picked.kg + " kg")
            : "Tap or drag the chart to see a day",
          { style: "caption", tone: picked ? "accent" : "muted" },
        ),
        ui.row({ gap: 2 }, [
          ui.slider({
            value: ui$.kcal,
            min: 50,
            max: 1500,
            step: 50,
            onChange: (value) => ((ui$.kcal = value), show()),
          }),
          ui.button("Log " + ui$.kcal + " kcal", { onPress: () => log({ kcal: ui$.kcal }) }),
        ]),
        ui.row({ gap: 2 }, [
          ui.slider({ value: ui$.kg, min: 40, max: 150, step: 0.5, onChange: (value) => ((ui$.kg = value), show()) }),
          ui.button("Log " + ui$.kg + " kg", { onPress: () => log({ kg: ui$.kg }) }),
        ]),
        ui.divider(),
        all
          .slice(-5)
          .reverse()
          .map((entry) =>
            ui.row({ key: entry.key, gap: 2 }, [
              ui.text(
                entry.at.slice(5, 16).replace("T", " ") + "  " + (entry.kcal ? entry.kcal + " kcal" : entry.kg + " kg"),
              ),
              ui.button("Delete", { onPress: () => remove(entry.key) }),
            ]),
          ),
      ]),
    )
  }
  // The canvas's width comes from a display frame (the widget's width) until a pointer event gives the canvas's own.
  const show = () => {
    const days = history(entries(), ui$.range)
    render(days)
    widget.draw("chart", chart(days, ui$))
  }
  widget.on("storage", () => show())
  widget.on("resumed", () => show())
  render(history(entries(), ui$.range))
  ui$.width = (await widget.frame()).width
  show()
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function label(day) {
  return MONTHS[Number(day.slice(5, 7)) - 1] + " " + Number(day.slice(8, 10))
}

function chart(days, ui$) {
  const g = ui.draw()
  const width = Math.max(ui$.width, PAD.left + PAD.right + days.length)
  const plot = { x: PAD.left, y: PAD.top, w: width - PAD.left - PAD.right, h: CHART - PAD.top - PAD.bottom }
  const slot = plot.w / days.length
  const kcalMax = Math.max(500, ...days.map((day) => day.kcal))
  const weights = days.filter((day) => day.kg !== null).map((day) => day.kg)
  const low = weights.length ? Math.floor(Math.min(...weights) - 1) : 70
  const high = weights.length ? Math.ceil(Math.max(...weights) + 1) : 90
  const kgY = (kg) => plot.y + plot.h - ((kg - low) / (high - low)) * plot.h
  // Grid and axes: weight on the left, calories on the right.
  for (let step = 0; step <= 2; step++) {
    const y = plot.y + (plot.h * step) / 2
    g.line(plot.x, y, plot.x + plot.w, y, { stroke: "border", width: 1 })
    g.text(plot.x - 6, y + 4, String(Math.round(high - ((high - low) * step) / 2)), {
      size: 10,
      align: "right",
      color: "muted",
    })
    g.text(plot.x + plot.w + 6, y + 4, String(Math.round(kcalMax - (kcalMax * step) / 2)), { size: 10, color: "muted" })
  }
  g.text(plot.x - 6, plot.y - 4, "kg", { size: 10, align: "right", color: "accent" })
  g.text(plot.x + plot.w + 6, plot.y - 4, "kcal", { size: 10, color: "warning" })
  // The picked day behind everything.
  const picked = days.findIndex((day) => day.day === ui$.picked)
  if (picked >= 0) g.rect(plot.x + picked * slot, plot.y, slot, plot.h, { fill: "surface" })
  // Calories as bars.
  days.forEach((day, index) => {
    if (day.kcal === 0) return
    const h = (day.kcal / kcalMax) * plot.h
    const inset = Math.min(slot * 0.2, 6)
    g.rrect(plot.x + index * slot + inset, plot.y + plot.h - h, slot - inset * 2, h, 2, {
      fill: index === picked ? "#f59e0bff" : "#f59e0b99",
    })
  })
  // Weight as a line through the days that have one.
  const points = days.flatMap((day, index) => (day.kg === null ? [] : [[plot.x + (index + 0.5) * slot, kgY(day.kg)]]))
  if (points.length > 1)
    g.path(
      points.map((point, index) => [index === 0 ? "M" : "L", point[0], point[1]]),
      { stroke: "accent", width: 2 },
    )
  points.forEach((point) => g.circle(point[0], point[1], 3, "accent"))
  // Day labels: every day in a week, every fifth in a month.
  const every = days.length > 7 ? 5 : 1
  days.forEach((day, index) => {
    if ((days.length - 1 - index) % every !== 0) return
    g.text(plot.x + (index + 0.5) * slot, CHART - 8, days.length > 7 ? label(day.day) : label(day.day).split(" ")[1], {
      size: 10,
      align: "center",
      color: index === picked ? "text" : "muted",
    })
  })
  if (picked >= 0)
    g.line(plot.x + (picked + 0.5) * slot, plot.y, plot.x + (picked + 0.5) * slot, plot.y + plot.h, {
      stroke: "text",
      width: 1,
    })
  return g
}
