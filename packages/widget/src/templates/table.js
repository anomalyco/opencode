// A sortable table built from regular nodes: each row is one monospace line so columns line up in every client (the
// TUI included), sort buttons above, and a small canvas sparkline per row for its `trend`. With `choose`, rows become
// selectable cards and the Choose button submits the selected row.

const SPARK_WIDTH = 96
const SPARK_HEIGHT = 22
const INTRO = 0.6
const MAX_WIDTH = 28

function init(data) {
  return { sort: null, desc: false, selected: null }
}

function view(state, data) {
  const widths = measure(data)
  const trend = data.rows.some((row) => row.trend)
  const wrap = (id, selected, children) =>
    data.choose
      ? ui.card({ id, selected }, [ui.row({ gap: 1, align: "center", wrap: true }, children)])
      : ui.row({ gap: 1, align: "center", wrap: true }, children)
  const picked = state.selected === null ? null : data.rows[state.selected]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.row({ gap: 1, align: "center", wrap: true }, [
      ui.text("Sort by", { style: "caption", tone: "muted" }),
      data.columns.map((column, index) =>
        ui.button("sort:" + index, column.label + (state.sort === index ? (state.desc ? " ↓" : " ↑") : ""), {
          variant: state.sort === index ? "primary" : "secondary",
        }),
      ),
    ]),
    wrap(undefined, false, [
      ui.text(
        line(
          data,
          widths,
          data.columns.map((column) => column.label),
          true,
        ),
        { style: "code", tone: "muted" },
      ),
      trend && ui.text(data.trendLabel ?? "Trend", { style: "caption", tone: "muted" }),
    ]),
    !data.choose && ui.divider(),
    order(state, data).map((index) =>
      wrap("row:" + index, state.selected === index, [
        ui.text(line(data, widths, data.rows[index].cells, false), { style: "code" }),
        trend &&
          data.rows[index].trend &&
          ui.canvas({
            id: "spark:" + index,
            width: SPARK_WIDTH,
            height: SPARK_HEIGHT,
            fps: 60,
            duration: INTRO,
            alt: (data.trendLabel ?? "Trend") + ": " + data.rows[index].trend.map(compact).join(", "),
          }),
      ]),
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("choose", picked ? "Choose " + text(data, 0, picked.cells[0]) : "Choose", {
          variant: "primary",
          disabled: !picked,
        }),
      ]),
  ])
}

function update(state, event, data) {
  if (event.id.startsWith("sort:")) {
    const column = Number(event.id.slice(5))
    if (state.sort === column) return { ...state, desc: !state.desc }
    return { ...state, sort: column, desc: numeric(data, column) }
  }
  if (event.id.startsWith("row:")) {
    const index = Number(event.id.slice(4))
    return { ...state, selected: state.selected === index ? null : index }
  }
  if (event.id === "choose" && state.selected !== null) {
    const row = data.rows[state.selected]
    return submit(
      {
        index: state.selected,
        row: Object.fromEntries(data.columns.map((column, at) => [column.label, row.cells[at] ?? null])),
      },
      state,
    )
  }
  return state
}

// A sparkline: the trend as a line over a faint area, drawn in from the left, with the last value marked.
function draw(state, data, frame) {
  const g = ui.draw()
  const values = data.rows[Number(frame.id.slice(6))].trend
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const x = (index) => 3 + ((frame.width - 6) * index) / Math.max(1, values.length - 1)
  const y = (value) => 3 + (frame.height - 6) * (1 - (value - min) / span)
  const shown = Math.max(1, Math.ceil(ease(frame.t / INTRO) * values.length))
  const points = values.slice(0, shown).map((value, index) => [index === 0 ? "M" : "L", x(index), y(value)])
  const stroke = data.color ?? "accent"
  if (points.length > 1)
    g.save()
      .alpha(0.15)
      .path([...points, ["L", x(shown - 1), frame.height], ["L", x(0), frame.height], ["Z"]], stroke)
      .restore()
  g.path(points, { stroke, width: 1.5, cap: "round" })
  if (shown === values.length) g.circle(x(shown - 1), y(values[shown - 1]), 2.5, stroke)
  return g.commands
}

// Row indices in display order: stable, numbers by value, text case-insensitively, empty cells last.
function order(state, data) {
  const indices = data.rows.map((_, index) => index)
  if (state.sort === null) return indices
  const key = (index) => {
    const cell = data.rows[index].cells[state.sort]
    return typeof cell === "string" ? cell.toLowerCase() : cell
  }
  return indices.sort((a, b) => {
    const left = key(a)
    const right = key(b)
    if (left === right) return a - b
    if (left === undefined || left === null) return 1
    if (right === undefined || right === null) return -1
    return (left < right ? -1 : 1) * (state.desc ? -1 : 1)
  })
}

function numeric(data, column) {
  return data.rows.every((row) => typeof (row.cells[column] ?? 0) === "number")
}

// Character widths of each column: the longest of the label and the formatted cells, capped at MAX_WIDTH.
function measure(data) {
  return data.columns.map((column, index) =>
    Math.min(
      MAX_WIDTH,
      Math.max(column.label.length, ...data.rows.map((row) => text(data, index, row.cells[index]).length)),
    ),
  )
}

function line(data, widths, cells, header) {
  return data.columns
    .map((_, index) => {
      const value = header ? cells[index] : text(data, index, cells[index])
      const cell = value.length > widths[index] ? value.slice(0, widths[index] - 1) + "…" : value
      return numeric(data, index) ? cell.padStart(widths[index]) : cell.padEnd(widths[index])
    })
    .join("  ")
}

function text(data, index, cell) {
  if (cell === undefined || cell === null) return "–"
  if (typeof cell === "string") return cell
  const column = data.columns[index]
  const digits = column.digits ?? (Number.isInteger(cell) ? 0 : 2)
  const [whole, fraction] = Math.abs(cell).toFixed(digits).split(".")
  const number = (cell < 0 ? "-" : "") + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? "." + fraction : "")
  const unit = column.unit
  if (!unit) return number
  if (/^[$€£¥]$/.test(unit)) return (cell < 0 ? "-" : "") + unit + number.replace("-", "")
  return unit.length > 1 && /^[a-z]/i.test(unit) ? number + " " + unit : number + unit
}

function compact(value) {
  return String(Math.round(value * 100) / 100)
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
