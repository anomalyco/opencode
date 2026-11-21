// A Gantt timeline: tasks with a start and an end (no end: a milestone), optionally in groups and with progress.
// Dates are "YYYY-MM-DD" (an end date is inclusive) or "YYYY-MM-DDTHH:MM"; plain numbers work too (week 1, 2...).
// `today` draws a marker (programs can't read the clock). Bars grow in; tap a bar to select it. With `choose`, the
// Choose button submits the selected task.

const ROW = 26
const TOP = 26
const INTRO = 0.7
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

// Rows (group headers, then their tasks) and the time range are computed once.
function init(data) {
  const groups = [...new Set(data.tasks.map((task) => task.group ?? ""))]
  const rows = groups.flatMap((group) => [
    ...(group ? [{ group }] : []),
    ...data.tasks.flatMap((task, index) => ((task.group ?? "") === group ? [{ task: index }] : [])),
  ])
  const spans = data.tasks.map((task) => span(task))
  const today = data.today === undefined ? null : time(data.today, false)
  const low = Math.min(...spans.map((item) => item.start), today ?? Infinity)
  const high = Math.max(...spans.map((item) => item.end), today ?? -Infinity)
  const pad = (high - low || 1) * 0.03
  const dates = typeof data.tasks[0].start === "string"
  return { selected: null, rows, spans, groups, dates, today, low: low - pad, high: high + pad }
}

function view(state, data) {
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: TOP + state.rows.length * ROW + 6,
      fps: 60,
      duration: INTRO,
      alt: summary(state, data),
    }),
    ui.text(state.selected === null ? "Tap a bar to see its dates" : describe(state, data, state.selected), {
      style: "caption",
      tone: state.selected === null ? "muted" : "default",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose task", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: state.selected === null,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const task = data.tasks[state.selected]
    return submit({
      label: task.label,
      index: state.selected,
      start: task.start,
      end: task.end ?? task.start,
      group: task.group,
    })
  }
  return state
}

function tap(state, data, pointer) {
  pointer = below(pointer)
  if (pointer.kind !== "up") return state
  const row = state.rows[Math.floor((pointer.y - TOP) / ROW)]
  const hit = pointer.y >= TOP && row && row.task !== undefined ? row.task : null
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  frame = below(frame)
  const g = ui.draw()
  if (frame.top) g.translate(0, frame.top)
  const box = layout(state, data, frame.width)
  const bottom = TOP + state.rows.length * ROW
  const today = state.today === null ? null : x(box, state.today)
  for (const tick of ticks(state, box)) {
    g.line(tick.x, TOP - 4, tick.x, bottom, { stroke: "border", width: 1 })
    if (today === null || tick.x + 50 < today - 22 || tick.x > today + 22)
      g.text(tick.x + 3, TOP - 10, tick.label, { size: 11, color: "muted" })
  }
  const hoverRow = frame.pointer && !frame.pointer.down ? Math.floor((frame.pointer.y - TOP) / ROW) : -1
  state.rows.forEach((row, at) => {
    const y = TOP + at * ROW
    if (row.group !== undefined) {
      const items = state.spans.filter((_, index) => (data.tasks[index].group ?? "") === row.group)
      const from = x(box, Math.min(...items.map((item) => item.start)))
      const to = x(box, Math.max(...items.map((item) => item.end)))
      g.text(8, y + 17, fit(row.group, box.left - 14, 12), { size: 12, weight: 600 })
      g.save()
        .alpha(0.5)
        .rrect(from, y + 11, Math.max(2, to - from), 4, 2, "muted")
        .restore()
      return
    }
    const task = data.tasks[row.task]
    const item = state.spans[row.task]
    const active = row.task === state.selected || at === hoverRow
    if (active) g.save().alpha(0.08).rect(0, y, frame.width, ROW, "text").restore()
    g.text(state.groups.length > 1 || state.groups[0] ? 18 : 8, y + 17, fit(task.label, box.left - 24, 12), {
      size: 12,
      weight: row.task === state.selected ? 600 : 400,
      color: active ? "text" : "muted",
    })
    const fill = task.color ?? PALETTE[state.groups.indexOf(task.group ?? "") % PALETTE.length]
    const grow = ease((frame.t - (0.3 * at) / state.rows.length) / (INTRO - 0.3))
    if (grow <= 0) return
    const from = x(box, item.start)
    if (task.end === undefined) {
      const s = 7 * grow
      g.path(
        [
          ["M", from, y + ROW / 2 - s],
          ["L", from + s, y + ROW / 2],
          ["L", from, y + ROW / 2 + s],
          ["L", from - s, y + ROW / 2],
          ["Z"],
        ],
        fill,
      )
      return
    }
    const w = Math.max(3, (x(box, item.end) - from) * grow)
    const progress = task.progress ?? 1
    if (progress < 1)
      g.save()
        .alpha(0.35)
        .rrect(from, y + 5, w, ROW - 10, 4, fill)
        .restore()
    if (progress > 0) g.rrect(from, y + 5, Math.max(3, w * progress), ROW - 10, 4, fill)
    if (row.task === state.selected) g.rrect(from - 1.5, y + 3.5, w + 3, ROW - 7, 5, { stroke: "text", width: 1.5 })
  })
  if (today !== null && frame.t >= INTRO * 0.5) {
    g.line(today, TOP - 4, today, bottom, { stroke: "error", width: 1.5 })
    g.rrect(today - 20, 4, 40, 14, 4, "error")
    g.text(today, 15, "Today", { size: 10, weight: 600, align: "center", color: "#ffffff" })
  }
  return g.commands
}

function layout(state, data, width) {
  const longest = Math.max(
    ...data.tasks.map((task) => task.label.length + 2),
    ...state.groups.map((group) => group.length),
  )
  const left = Math.min(width * 0.38, 180, Math.max(80, 16 + 6.6 * longest))
  return { left, w: Math.max(1, width - left - 12), low: state.low, high: state.high }
}

function x(box, value) {
  return box.left + (box.w * (value - box.low)) / (box.high - box.low)
}

// Tick marks for the axis: hours, days, weeks, months or years for dates; nice steps for plain numbers.
function ticks(state, box) {
  const perDay = box.w / (state.high - state.low)
  const out = []
  if (!state.dates) {
    const raw = 64 / perDay
    const power = Math.pow(10, Math.floor(Math.log10(raw)))
    const step = power * ([1, 2, 5, 10].find((factor) => factor * power >= raw) ?? 10)
    for (let value = Math.ceil(state.low / step) * step; value <= state.high; value += step)
      out.push({ x: x(box, value), label: String(Math.round(value * 100) / 100) })
    return out
  }
  const step = [1 / 24, 3 / 24, 6 / 24, 12 / 24, 1, 2, 7, 14].find((days) => days * perDay >= 64)
  if (step !== undefined) {
    const first = step >= 7 ? Math.ceil((state.low + 3) / 7) * 7 - 3 : Math.ceil(state.low / step) * step
    for (let value = first; value <= state.high; value += step)
      out.push({
        x: x(box, value),
        label: step < 1 ? String(Math.round((value % 1) * 24)).padStart(2, "0") + ":00" : short(value),
      })
    return out
  }
  const months = [1, 3, 12].find((count) => count * 30.4 * perDay >= 64) ?? 12
  let [year, month] = civil(Math.floor(state.low))
  month = Math.ceil(month / months) * months - months + 1
  for (let value = days(year, month, 1); value <= state.high; ) {
    if (value >= state.low)
      out.push({
        x: x(box, value),
        label: months === 12 ? String(year) : month === 1 ? MONTHS[0] + " " + year : MONTHS[month - 1],
      })
    month += months
    if (month > 12) {
      month -= 12
      year++
    }
    value = days(year, month, 1)
  }
  return out
}

// A task's start and end as numbers (days since 1970 for dates). A date-only end includes that day.
function span(task) {
  const start = time(task.start, false)
  return { start, end: task.end === undefined ? start : Math.max(start, time(task.end, true)) }
}

function time(value, end) {
  if (typeof value === "number") return value
  const [date, clock] = value.split("T")
  const [y, m, d] = date.split("-").map(Number)
  const [hours, minutes] = clock ? clock.split(":").map(Number) : [0, 0]
  return days(y, m, d) + (clock ? (hours + (minutes || 0) / 60) / 24 : end ? 1 : 0)
}

// Days since 1970-01-01 in the civil calendar, and back.
function days(y, m, d) {
  const year = m <= 2 ? y - 1 : y
  const era = Math.floor(year / 400)
  const yoe = year - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468
}

function civil(day) {
  const z = day + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const m = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - Math.floor((153 * mp + 2) / 5) + 1]
}

function short(day) {
  const [, m, d] = civil(Math.floor(day))
  return MONTHS[m - 1] + " " + d
}

function when(state, value) {
  return state.dates ? short(value) : String(Math.round(value * 100) / 100)
}

function describe(state, data, index) {
  const task = data.tasks[index]
  const item = state.spans[index]
  const length = item.end - item.start
  const dates =
    task.end === undefined
      ? when(state, item.start) + " (milestone)"
      : when(state, item.start) +
        " – " +
        when(state, state.dates && typeof task.end === "string" && !task.end.includes("T") ? item.end - 1 : item.end) +
        (state.dates ? " (" + Math.round(length * 10) / 10 + (length === 1 ? " day)" : " days)") : "")
  return [
    task.label,
    dates,
    task.progress !== undefined ? Math.round(task.progress * 100) + "% done" : "",
    task.group ?? "",
  ]
    .filter(Boolean)
    .join(" · ")
}

function summary(state, data) {
  return (
    "Timeline of " +
    data.tasks.length +
    " tasks" +
    (state.today !== null ? ", today " + when(state, state.today) : "") +
    ". " +
    data.tasks.map((_, index) => describe(state, data, index)).join("; ")
  )
}

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}

// In full screen, the layout starts below the close button when it overlaps this canvas (widgets-fullscreen.md):
// `close` comes with the frame and the pointer, so drawing and hit testing agree.
function below(area) {
  const top = area.close ? Math.max(0, area.close.y + area.close.height) : 0
  if (top === 0) return area
  return {
    ...area,
    top,
    height: area.height - top,
    ...(typeof area.y === "number" ? { y: area.y - top } : {}),
    ...(area.pointer ? { pointer: { ...area.pointer, y: area.pointer.y - top } } : {}),
  }
}
