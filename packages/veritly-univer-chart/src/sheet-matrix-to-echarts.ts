export type ChartKind = "bar" | "line" | "pie" | "stack"

export type SheetTable = {
  headers?: string[]
  rows: unknown[][]
}

export type ChartPalette = {
  fg: string
  muted: string
  border: string
  series: string[]
  /** Opaque chart area (matches app surface). */
  panel: string
}

function cellScalar(v: unknown): string | number | null {
  if (v === null || v === undefined) return null
  if (typeof v === "number" && !Number.isNaN(v)) return v
  if (typeof v === "boolean") return v ? 1 : 0
  if (typeof v === "string") {
    const t = v.trim()
    if (t === "") return null
    const n = Number(t)
    if (!Number.isNaN(n) && t !== "") return n
    return t
  }
  if (typeof v === "object") {
    const inner = Reflect.get(v as object, "v")
    if (inner !== undefined) return cellScalar(inner)
  }
  return null
}

function asNum(v: string | number | null): number | null {
  if (v === null) return null
  if (typeof v === "number" && !Number.isNaN(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    if (!Number.isNaN(n)) return n
  }
  return null
}

function seriesType(kind: ChartKind) {
  if (kind === "line") return "line"
  return "bar"
}

function stackId(kind: ChartKind) {
  if (kind === "stack") return "tot"
  return undefined
}

function buildPie(table: SheetTable, palette: ChartPalette, textStyle: { color: string }): Record<string, unknown> {
  const rows = table.rows
  const data: { name: string; value: number }[] = []
  if (rows.length === 0) {
    return {
      backgroundColor: palette.panel,
      title: { text: "No data", left: "center", top: "middle", textStyle },
      series: [],
    }
  }

  const sheetHeaders = table.headers
  if (sheetHeaders && sheetHeaders.length >= 2) {
    for (const row of rows) {
      const name = String(cellScalar(row[0]) ?? "")
      let sum = 0
      for (let c = 1; c < row.length; c++) {
        const n = asNum(cellScalar(row[c]))
        if (n !== null) sum += n
      }
      data.push({ name: name || "—", value: sum })
    }
  } else {
    for (const row of rows) {
      if (row.length < 2) continue
      const name = String(cellScalar(row[0]) ?? "")
      const v = asNum(cellScalar(row[1]))
      if (v === null) continue
      data.push({ name: name || "—", value: v })
    }
  }

  if (data.length === 0) {
    return {
      backgroundColor: palette.panel,
      title: { text: "No numeric data", left: "center", top: "middle", textStyle },
      series: [],
    }
  }

  return {
    backgroundColor: palette.panel,
    color: palette.series,
    tooltip: { trigger: "item" },
    series: [
      {
        type: "pie",
        radius: ["36%", "70%"],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: palette.border, borderWidth: 1 },
        label: { color: palette.fg },
        data,
      },
    ],
  }
}

function buildCartesianColumns(
  kind: ChartKind,
  table: SheetTable,
  palette: ChartPalette,
  textStyle: { color: string },
  axisLabel: { color: string },
  splitLine: { lineStyle: { color: string } },
): Record<string, unknown> {
  const stack = stackId(kind)
  const st = seriesType(kind)
  const rows = table.rows
  const headers = table.headers

  if (rows.length === 0) {
    return {
      backgroundColor: palette.panel,
      title: { text: "No data", left: "center", top: "middle", textStyle },
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [],
    }
  }

  let colHeaders: string[]
  let body: unknown[][]
  if (headers && headers.length > 0) {
    colHeaders = headers.map((h, i) => (String(h || "").trim() ? String(h) : `C${i + 1}`))
    body = rows
  } else if (rows.length > 1) {
    const top = rows[0]!
    colHeaders = top.map((cell, i) => String(cellScalar(cell) ?? `C${i + 1}`))
    body = rows.slice(1)
  } else {
    const only = rows[0]!
    colHeaders = only.map((_, i) => `C${i + 1}`)
    body = rows
  }

  const categories = body.map((row) => String(cellScalar(row[0]) ?? ""))
  const series: Record<string, unknown>[] = []
  for (let j = 1; j < colHeaders.length; j++) {
    const name = colHeaders[j] ?? `S${j}`
    const data = body.map((row) => {
      const n = asNum(cellScalar(row[j]))
      return n === null ? 0 : n
    })
    const item: Record<string, unknown> = {
      name,
      type: st,
      data,
      emphasis: { focus: "series" },
    }
    const sid = stackId(kind)
    if (sid) item.stack = sid
    if (st === "line") {
      item.smooth = true
      item.symbolSize = 6
    }
    if (st === "bar") {
      item.barMaxWidth = 42
      item.itemStyle = { borderRadius: [4, 4, 0, 0] }
    }
    series.push(item)
  }

  if (colHeaders.length < 2) {
    return {
      backgroundColor: palette.panel,
      title: { text: "Need at least two columns", left: "center", top: "middle", textStyle },
      xAxis: { type: "category", data: categories },
      yAxis: { type: "value", axisLabel, splitLine },
      series: [],
    }
  }

  const legend = series.map((s) => String(s.name))

  return {
    backgroundColor: palette.panel,
    color: palette.series,
    textStyle,
    tooltip: { trigger: "axis" },
    legend: { data: legend, textStyle: { color: palette.muted } },
    grid: { left: 48, right: 16, top: series.length > 1 ? 48 : 24, bottom: 40, containLabel: true },
    xAxis: {
      type: "category",
      data: categories,
      axisLine: { lineStyle: { color: palette.border } },
      axisLabel: { ...axisLabel, rotate: categories.some((c) => c.length > 8) ? 28 : 0 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel,
      splitLine,
    },
    series,
  }
}

function buildCartesianTranspose(
  kind: ChartKind,
  table: SheetTable,
  palette: ChartPalette,
  textStyle: { color: string },
  axisLabel: { color: string },
  splitLine: { lineStyle: { color: string } },
): Record<string, unknown> {
  const st = seriesType(kind)
  const rows = table.rows
  const headers = table.headers

  if (!headers || headers.length < 2) {
    return {
      backgroundColor: palette.panel,
      title: {
        text: "Series-in-rows needs a header row",
        left: "center",
        top: "middle",
        textStyle: { color: palette.muted, fontSize: 12 },
      },
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [],
    }
  }

  const xData = headers.slice(1).map((h, i) => String(h || "").trim() || `C${i + 2}`)
  const series: Record<string, unknown>[] = []

  for (const row of rows) {
    const name = String(cellScalar(row[0]) ?? "Series")
    const slice = row.slice(1)
    const data = xData.map((_, idx) => {
      const n = asNum(cellScalar(slice[idx]))
      return n === null ? 0 : n
    })
    const item: Record<string, unknown> = {
      name,
      type: st,
      data,
      emphasis: { focus: "series" },
    }
    const sid = stackId(kind)
    if (sid) item.stack = sid
    if (st === "line") {
      item.smooth = true
      item.symbolSize = 6
    }
    if (st === "bar") {
      item.barMaxWidth = 36
      item.itemStyle = { borderRadius: [4, 4, 0, 0] }
    }
    series.push(item)
  }

  return {
    backgroundColor: palette.panel,
    color: palette.series,
    textStyle,
    tooltip: { trigger: "axis" },
    legend: { data: series.map((s) => String(s.name)), textStyle: { color: palette.muted } },
    grid: { left: 48, right: 16, top: series.length > 1 ? 48 : 24, bottom: 40, containLabel: true },
    xAxis: {
      type: "category",
      data: xData,
      axisLine: { lineStyle: { color: palette.border } },
      axisLabel: { ...axisLabel, rotate: xData.some((c) => c.length > 8) ? 28 : 0 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel,
      splitLine,
    },
    series,
  }
}

export function tableToEChartsOption(input: {
  kind: ChartKind
  seriesInRows: boolean
  table: SheetTable
  palette: ChartPalette
}): Record<string, unknown> {
  const { kind, seriesInRows, table, palette } = input
  const textStyle = { color: palette.fg }
  const axisLabel = { color: palette.muted }
  const splitLine = { lineStyle: { color: palette.border } }

  if (kind === "pie") {
    return buildPie(table, palette, textStyle)
  }

  if (seriesInRows) {
    return buildCartesianTranspose(kind, table, palette, textStyle, axisLabel, splitLine)
  }
  return buildCartesianColumns(kind, table, palette, textStyle, axisLabel, splitLine)
}
