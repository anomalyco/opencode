// A sortable data table on the native `table` node: clients draw it like their markdown tables (the TUI as aligned
// text), a header press sorts by its column, and each row's `trend` shows as a text sparkline in a column of its own (a
// table's cells hold text, not nodes). With `choose`, a row press selects a row and the Choose button submits it.

const SPARK = "▁▂▃▄▅▆▇█"

function init(data) {
  return { sort: null, desc: false, selected: null }
}

function view(state, data) {
  const trend = data.rows.some((row) => row.trend)
  // Row indices in display order; the table's rows are in this order, so a row press maps back through it.
  const shown = order(state, data)
  const picked = state.selected === null ? null : data.rows[state.selected]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.table(
      [
        ...data.columns.map((column, index) => ({
          label: column.label,
          align: numeric(data, index) ? "end" : "start",
        })),
        ...(trend ? [data.trendLabel ?? "Trend"] : []),
      ],
      shown.map((index) => [
        ...data.columns.map((_, column) => text(data, column, data.rows[index].cells[column])),
        ...(trend ? [spark(data.rows[index].trend)] : []),
      ]),
      {
        sort: state.sort === null ? undefined : { column: state.sort, descending: state.desc },
        selected: data.choose && state.selected !== null ? shown.indexOf(state.selected) : undefined,
        // The trend column doesn't sort; numbers sort largest first, text A to Z, a second press the other way.
        onSort: (state, column) =>
          column >= data.columns.length
            ? state
            : state.sort === column
              ? { ...state, desc: !state.desc }
              : { ...state, sort: column, desc: numeric(data, column) },
        onPress: data.choose
          ? (state, row) => ({ ...state, selected: state.selected === shown[row] ? null : shown[row] })
          : undefined,
      },
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button(picked ? "Choose " + text(data, 0, picked.cells[0]) : "Choose", {
          variant: "primary",
          disabled: !picked,
          onPress: (state) => choose(state, data),
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected === null) return state
  const row = data.rows[state.selected]
  return submit({
    index: state.selected,
    row: Object.fromEntries(data.columns.map((column, at) => [column.label, row.cells[at] ?? null])),
  })
}

// A trend as block characters scaled to its own range, lowest ▁ to highest █; no trend is empty.
function spark(values) {
  if (!values || values.length === 0) return ""
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  return values.map((value) => SPARK[Math.round(((value - min) / span) * (SPARK.length - 1))]).join("")
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
