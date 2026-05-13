import type { ICommandInfo, Serializable } from "@univerjs/core"
import { ICommandService } from "@univerjs/core"
import { createUniverSdk, type RangeRect, type UniverSdkRuntime } from "@opencode-ai/univer-sdk"
import * as echarts from "echarts/core"
import { BarChart, LineChart, PieChart } from "echarts/charts"
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import * as React from "react"
import { parseSheetBangRange, rectsOverlap } from "@/lib/sheet-bang-range"
import {
  type ChartKind,
  type ChartPalette,
  type SheetTable,
  tableToEChartsOption,
} from "@/lib/sheet-matrix-to-echarts"
import { veritlyUniverHost } from "@/lib/veritly-univer-runtime"

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])

type UniverWithInjector = {
  __getInjector(): { get<T>(t: unknown): T }
}

type ChartData = {
  range?: string
  isRowDirection?: boolean
}

function asChartData(d: Serializable | undefined): ChartData {
  if (!d || typeof d !== "object") return {}
  const o = d as Record<string, unknown>
  return {
    range: typeof o.range === "string" ? o.range : undefined,
    isRowDirection: typeof o.isRowDirection === "boolean" ? o.isRowDirection : undefined,
  }
}

function paletteFromEl(el: HTMLElement, dark: boolean): ChartPalette {
  const cs = getComputedStyle(el)
  const fg = cs.getPropertyValue("--text-base").trim()
  const muted = cs.getPropertyValue("--text-weak").trim()
  const border = cs.getPropertyValue("--border-base").trim()
  const series = dark
    ? ["#60a5fa", "#4ade80", "#fb923c", "#c084fc", "#f472b6", "#2dd4bf"]
    : ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0d9488"]
  return {
    fg: fg || (dark ? "#ededed" : "#171717"),
    muted: muted || (dark ? "#a0a0a0" : "#6f6f6f"),
    border: border || (dark ? "#505050" : "#c7c7c7"),
    series,
  }
}

function appDark(): boolean {
  if (typeof document === "undefined") return false
  return document.documentElement.classList.contains("dark")
}

export type VeritlyLiveChartFloatProps = {
  data?: Serializable
  unitId: string
  unit: unknown
  floatDomId: string
}

export function VeritlyLiveChartFloat(props: VeritlyLiveChartFloatProps) {
  void props.unit
  const payload = React.useMemo(() => asChartData(props.data), [props.data])
  const parsed = React.useMemo(() => {
    if (!payload.range) return null
    try {
      return parseSheetBangRange(payload.range)
    } catch {
      return null
    }
  }, [payload.range])

  const [sheetId, setSheetId] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<ChartKind>("bar")
  const [seriesInRows, setSeriesInRows] = React.useState(Boolean(payload.isRowDirection))
  const [table, setTable] = React.useState<SheetTable>({ rows: [] })
  const [dark, setDark] = React.useState(appDark)
  const [err, setErr] = React.useState<string | null>(null)

  const wrapRef = React.useRef<HTMLDivElement>(null)
  const chartRef = React.useRef<HTMLDivElement>(null)
  const chartInst = React.useRef<echarts.ECharts | undefined>(undefined)

  const srcRange = parsed?.range ?? null
  const sheetTitle = parsed?.sheet ?? null

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    const obs = new MutationObserver(() => setDark(appDark()))
    obs.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])

  React.useEffect(() => {
    if (payload.isRowDirection !== undefined) setSeriesInRows(payload.isRowDirection)
  }, [payload.isRowDirection])

  const resolveSheetId = React.useCallback(() => {
    const slot = veritlyUniverHost()
    if (!slot || !sheetTitle) return null
    const meta = createUniverSdk({ univerAPI: slot.univerAPI, univer: slot.univer } as unknown as UniverSdkRuntime).listSheets()
    const row = meta.find((x) => x.name === sheetTitle)
    return row ? row.id : null
  }, [sheetTitle])

  React.useEffect(() => {
    setSheetId(resolveSheetId())
  }, [resolveSheetId, props.unitId])

  const pull = React.useCallback(() => {
    setErr(null)
    const slot = veritlyUniverHost()
    if (!slot || !srcRange || !sheetId) {
      setTable({ rows: [] })
      if (!sheetTitle) setErr("Missing range")
      else if (!sheetId) setErr(`Unknown sheet: ${sheetTitle}`)
      return
    }
    const sdk = createUniverSdk({ univerAPI: slot.univerAPI, univer: slot.univer } as unknown as UniverSdkRuntime)
    const t = sdk.extractTable({ sheetId, range: srcRange, withHeaders: true })
    setTable({ headers: t.headers, rows: t.rows as unknown[][] })
  }, [sheetId, sheetTitle, srcRange])

  React.useEffect(() => {
    pull()
  }, [pull])

  React.useEffect(() => {
    const slot = veritlyUniverHost()
    if (!slot) return
    const u = slot.univer as UniverWithInjector
    const cmd = u.__getInjector().get(ICommandService) as {
      onCommandExecuted(cb: (info: ICommandInfo) => void): { dispose(): void }
    }
    const sub = cmd.onCommandExecuted((info) => {
      if (info.id !== "sheet.mutation.set-range-values") return
      const p = info.params as {
        unitId?: string
        subUnitId?: string
        range?: RangeRect
      }
      if (p.unitId !== props.unitId || !sheetId || p.subUnitId !== sheetId) return
      if (!p.range || !srcRange || !rectsOverlap(p.range, srcRange)) return
      pull()
    })
    return () => sub.dispose()
  }, [props.unitId, pull, sheetId, srcRange])

  React.useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const c = echarts.init(el, undefined, { renderer: "canvas" })
    chartInst.current = c
    const ro = new ResizeObserver(() => {
      c.resize()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      c.dispose()
      chartInst.current = undefined
    }
  }, [])

  React.useEffect(() => {
    const c = chartInst.current
    const panel = wrapRef.current
    if (!c || !panel) return
    const opt = tableToEChartsOption({
      kind,
      seriesInRows,
      table,
      palette: paletteFromEl(panel, dark),
    })
    c.setOption(opt, { notMerge: true })
  }, [dark, kind, seriesInRows, table])

  if (!parsed || !srcRange) {
    return React.createElement(
      "div",
      { style: { padding: 8, fontSize: 12, color: "#888" }, "data-float-dom-chart": props.floatDomId },
      "Invalid chart range",
    )
  }

  return React.createElement(
    "div",
    {
      ref: wrapRef,
      "data-float-dom-chart": props.floatDomId,
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        background: "transparent",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          flexShrink: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          padding: "4px 6px",
          borderBottom: "1px solid rgba(128,128,128,0.25)",
        },
      },
      React.createElement(
        "select",
        {
          "aria-label": "Chart type",
          value: kind,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setKind(e.target.value as ChartKind),
          style: { fontSize: 11, maxWidth: "100%" },
        },
        React.createElement("option", { value: "bar" }, "Bar"),
        React.createElement("option", { value: "line" }, "Line"),
        React.createElement("option", { value: "pie" }, "Pie"),
        React.createElement("option", { value: "stack" }, "Stack"),
      ),
      React.createElement(
        "label",
        { style: { fontSize: 11, display: "flex", alignItems: "center", gap: 4 } },
        React.createElement("input", {
          type: "checkbox",
          checked: seriesInRows,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSeriesInRows(e.target.checked),
        }),
        "Series in rows",
      ),
      React.createElement(
        "button",
        { type: "button", style: { fontSize: 11 }, onClick: () => pull() },
        "Refresh",
      ),
    ),
    err ? React.createElement("div", { style: { padding: 6, fontSize: 11, color: "#c00", flexShrink: 0 } }, err) : null,
    React.createElement("div", {
      ref: chartRef,
      style: { flex: 1, minHeight: 0, width: "100%" },
    }),
  )
}
