// A heatmap: a matrix of rows × columns, or a calendar of daily values in week columns (like a contribution graph).
// Values map to LEVELS shades of one color (two for data with negative and positive values), drawn level by level so
// a frame stays cheap; a legend shows the scale. Tap a cell to select it. With `choose`, the Choose button submits it.

const INTRO = 0.6
const LEVELS = 6
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""]

// The calendar grid is laid out once: one cell per day from the Monday before the first date to the last date.
function init(data) {
  if (data.layout !== "calendar") return { selected: null, cells: null }
  const values = new Map(data.days.map((day) => [days(day.date), day.value]))
  const keys = [...values.keys()]
  const first = Math.min(...keys)
  const start = first - ((first + 3) % 7)
  const cells = []
  for (let day = start; day <= Math.max(...keys); day++)
    cells.push({ day, column: Math.floor((day - start) / 7), row: (day + 3) % 7, value: values.get(day) ?? null })
  return { selected: null, cells }
}

function view(state, data) {
  const picked = state.selected === null ? null : cell(state, data, state.selected)
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: height(state, data),
      fps: 60,
      duration: INTRO,
      alt: summary(state, data),
    }),
    ui.text(
      picked
        ? picked.name + ": " + (picked.value === null ? "no data" : amount(picked.value, data.unit))
        : "Tap a cell to read it",
      {
        style: "caption",
        tone: picked ? "default" : "muted",
      },
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose cell", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: !picked || picked.value === null,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const picked = cell(state, data, state.selected)
    return submit(
      data.layout === "calendar"
        ? { date: picked.name, value: picked.value }
        : { row: data.rows[picked.row], column: data.columns[picked.column], value: picked.value },
    )
  }
  return state
}

function tap(state, data, pointer) {
  pointer = below(pointer)
  if (pointer.kind !== "up") return state
  const hit = locate(state, data, layout(state, data, pointer.width, pointer.height), pointer.x, pointer.y)
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  frame = below(frame)
  const g = ui.draw()
  if (frame.top) g.translate(0, frame.top)
  const box = layout(state, data, frame.width, frame.height)
  const cells = grid(state, data)
  const scale = levels(cells, data)
  const hover = frame.pointer && !frame.pointer.down ? locate(state, data, box, frame.pointer.x, frame.pointer.y) : null
  labels(g, state, data, box)
  // Empty cells first, then one save/alpha/restore group per shade.
  const reveal = (item) => ease((frame.t - (0.35 * item.column) / Math.max(1, box.columns)) / (INTRO - 0.35))
  const square = (item, paint) => {
    const grow = reveal(item)
    if (grow <= 0) return
    const w = (box.cw - 2) * grow
    const h = (box.ch - 2) * grow
    const x = box.x + item.column * box.cw + (box.cw - w) / 2
    const y = box.y + item.row * box.ch + (box.ch - h) / 2
    g.rrect(x, y, w, h, Math.min(3, w / 4, h / 4), paint)
  }
  const groups = scale.shades.map(() => [])
  for (const item of cells) {
    if (item.value === null) square(item, "surface")
    else groups[level(scale, item.value)].push(item)
  }
  scale.shades.forEach((shade, index) => {
    if (groups[index].length === 0) return
    g.save().alpha(shade.alpha)
    groups[index].forEach((item) => square(item, shade.color))
    g.restore()
  })
  for (const key of [hover, state.selected]) {
    if (key === null || frame.t < INTRO) continue
    const item = cells[key]
    g.rrect(box.x + item.column * box.cw, box.y + item.row * box.ch, box.cw, box.ch, 3, {
      stroke: "text",
      width: key === state.selected ? 2 : 1,
    })
  }
  legend(g, data, scale, box, frame.width)
  return g.commands
}

function height(state, data) {
  if (data.layout === "calendar") return 7 * 14 + 20 + 34
  return 20 + data.rows.length * Math.max(14, Math.min(32, Math.floor(320 / data.rows.length))) + 34
}

// The cells of either layout as { column, row, value }; a cell's key is its index here.
function grid(state, data) {
  if (data.layout === "calendar") return state.cells
  return data.rows.flatMap((_, r) =>
    data.columns.map((_, c) => ({ column: c, row: r, value: data.values[r]?.[c] ?? null })),
  )
}

function cell(state, data, key) {
  const item = grid(state, data)[key]
  const name = data.layout === "calendar" ? format(item.day) : data.rows[item.row] + " × " + data.columns[item.column]
  return { ...item, name }
}

// Geometry shared by draw and tap: matrix cells fill the width; calendar cells are squares.
function layout(state, data, width, height) {
  const calendar = data.layout === "calendar"
  const rows = calendar ? 7 : data.rows.length
  const columns = calendar ? state.cells[state.cells.length - 1].column + 1 : data.columns.length
  const left = calendar ? 34 : Math.min(130, 12 + 6.6 * Math.max(...data.rows.map((row) => row.length)))
  const top = 20
  const ch = (height - top - 34) / rows
  const cw = Math.max(4, Math.min((width - left - 8) / columns, calendar ? ch : 120))
  return { x: left, y: top, cw, ch: calendar ? cw : ch, rows, columns }
}

function locate(state, data, box, px, py) {
  const column = Math.floor((px - box.x) / box.cw)
  const row = Math.floor((py - box.y) / box.ch)
  if (column < 0 || row < 0 || column >= box.columns || row >= box.rows) return null
  if (data.layout !== "calendar") return row * data.columns.length + column
  const key = state.cells.findIndex((item) => item.column === column && item.row === row)
  return key < 0 ? null : key
}

function labels(g, state, data, box) {
  const size = 11
  if (data.layout === "calendar") {
    WEEKDAYS.forEach(
      (name, row) =>
        name &&
        g.text(box.x - 6, box.y + row * box.ch + box.ch / 2 + 4, name, { size: 10, align: "right", color: "muted" }),
    )
    // A month is labelled at the week of its 1st; the first partial month only when there is room before the next.
    const starts = state.cells.filter((item, index) => index === 0 || civil(item.day)[2] === 1)
    starts.forEach((item, index) => {
      if (index + 1 < starts.length && starts[index + 1].column - item.column < 3) return
      g.text(box.x + item.column * box.cw, box.y - 6, MONTHS[civil(item.day)[1] - 1], { size: 10, color: "muted" })
    })
    return
  }
  data.rows.forEach((row, r) =>
    g.text(box.x - 6, box.y + r * box.ch + box.ch / 2 + 4, fit(row, box.x - 10, size), {
      size,
      align: "right",
      color: "muted",
    }),
  )
  const every = Math.max(1, Math.ceil((6.6 * Math.max(...data.columns.map((column) => column.length)) + 6) / box.cw))
  data.columns.forEach((column, c) => {
    if (c % every === 0)
      g.text(box.x + c * box.cw + box.cw / 2, box.y - 6, fit(column, box.cw * every - 4, size), {
        size,
        align: "center",
        color: "muted",
      })
  })
}

// A sequential scale in one color, or a diverging one (blue below zero, red above) when values cross zero.
function levels(cells, data) {
  const values = cells.flatMap((item) => (item.value === null ? [] : [item.value]))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const diverging = min < 0 && max > 0
  const shades = []
  for (let index = 0; index < LEVELS; index++) {
    const alpha = Math.round((0.18 + (0.82 * index) / (LEVELS - 1)) * 100) / 100
    if (diverging) {
      shades.push({
        alpha,
        color: data.color ?? "#ef4444",
        low: (max * index) / LEVELS,
        high: (max * (index + 1)) / LEVELS,
      })
      shades.push({ alpha, color: "#3b82f6", low: (min * (index + 1)) / LEVELS, high: (min * index) / LEVELS })
    } else
      shades.push({
        alpha,
        color: data.color ?? "accent",
        low: min + ((max - min) * index) / LEVELS,
        high: min + ((max - min) * (index + 1)) / LEVELS,
      })
  }
  return { min, max, diverging, shades }
}

function level(scale, value) {
  if (scale.max === scale.min) return scale.shades.length - 1
  if (!scale.diverging)
    return Math.min(LEVELS - 1, Math.floor(((value - scale.min) / (scale.max - scale.min)) * LEVELS))
  const index = Math.min(LEVELS - 1, Math.floor((value < 0 ? value / scale.min : value / scale.max) * LEVELS))
  return index * 2 + (value < 0 ? 1 : 0)
}

function legend(g, data, scale, box, width) {
  const y = box.y + box.rows * box.ch + 14
  const swatch = 14
  const order = scale.diverging
    ? [
        ...scale.shades.filter((shade) => shade.color === "#3b82f6").reverse(),
        ...scale.shades.filter((shade) => shade.color !== "#3b82f6"),
      ]
    : scale.shades
  const right = Math.min(width - 8, box.x + box.columns * box.cw)
  const maxText = amount(scale.max, data.unit)
  const left = right - 8 - 7 * maxText.length - order.length * (swatch + 2)
  g.text(left - 6, y + 11, amount(scale.min, data.unit), { size: 11, align: "right", color: "muted" })
  order.forEach((shade, index) => {
    g.save().alpha(shade.alpha)
    g.rrect(left + index * (swatch + 2), y, swatch, swatch, 3, shade.color)
    g.restore()
  })
  g.text(left + order.length * (swatch + 2) + 4, y + 11, maxText, { size: 11, color: "muted" })
}

// Days since 1970-01-01 for "YYYY-MM-DD" (civil calendar, no time zones).
function days(date) {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number)
  const year = m <= 2 ? y - 1 : y
  const era = Math.floor(year / 400)
  const yoe = year - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  return era * 146097 + (yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy) - 719468
}

function civil(day) {
  const z = day + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d]
}

function format(day) {
  const [y, m, d] = civil(day)
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0")
}

function summary(state, data) {
  const values = grid(state, data).flatMap((item, key) => (item.value === null ? [] : [{ ...item, key }]))
  const top = [...values]
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((item) => cell(state, data, item.key))
  return (
    (data.layout === "calendar"
      ? "Calendar heatmap of " + values.length + " days"
      : "Heatmap of " + data.rows.length + " rows by " + data.columns.length + " columns") +
    ", values " +
    amount(Math.min(...values.map((item) => item.value)), data.unit) +
    " to " +
    amount(Math.max(...values.map((item) => item.value)), data.unit) +
    ". Highest: " +
    top.map((item) => item.name + " " + amount(item.value, data.unit)).join(", ")
  )
}

function amount(value, unit) {
  const text = String(Math.round(value * 100) / 100)
  if (!unit) return text
  return unit.length > 1 && /^[a-z]/i.test(unit) ? text + " " + unit : text + unit
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
