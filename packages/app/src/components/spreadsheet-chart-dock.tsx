import type { FUniver } from "@univerjs/core/facade"
import { createUniverSdk } from "@opencode-ai/univer-sdk"
import * as echarts from "echarts/core"
import { BarChart, LineChart, PieChart } from "echarts/charts"
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { dict } from "@/i18n/en"
import { activeSheetSelectionRange } from "@/lib/sheet-chart-range"
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

type Sdk = ReturnType<typeof createUniverSdk>

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

export function SpreadsheetChartDock(props: { getSdk: () => Sdk; dark: boolean; onClose: () => void }) {
  const [panelEl, setPanelEl] = createSignal<HTMLDivElement | undefined>()
  const [chartHost, setChartHost] = createSignal<HTMLDivElement | undefined>()
  const [chartInst, setChartInst] = createSignal<echarts.ECharts | undefined>()
  const [table, setTable] = createSignal<SheetTable>({ rows: [] })
  const [kind, setKind] = createSignal<ChartKind>("bar")
  const [seriesInRows, setSeriesInRows] = createSignal(false)
  const [withHeaders, setWithHeaders] = createSignal(true)
  const [hint, setHint] = createSignal<string | null>(null)

  const pull = () => {
    setHint(null)
    const slot = veritlyUniverHost()
    if (!slot) {
      setHint(dict["univer.chartDock.noHost"])
      return
    }
    const range = activeSheetSelectionRange(slot.univerAPI as FUniver)
    const t = props.getSdk().extractTable({ range, withHeaders: withHeaders() })
    setTable({
      headers: t.headers,
      rows: t.rows as unknown[][],
    })
  }

  createEffect(() => {
    withHeaders()
    pull()
  })

  createEffect(() => {
    const host = chartHost()
    if (!host) return
    const c = echarts.init(host, undefined, { renderer: "canvas" })
    setChartInst(c)
    const ro = new ResizeObserver(() => {
      c.resize()
    })
    ro.observe(host)
    onCleanup(() => {
      ro.disconnect()
      c.dispose()
      setChartInst(undefined)
    })
  })

  createEffect(() => {
    const c = chartInst()
    const panel = panelEl()
    if (!c || !panel) return
    table()
    kind()
    seriesInRows()
    props.dark
    const opt = tableToEChartsOption({
      kind: kind(),
      seriesInRows: seriesInRows(),
      table: table(),
      palette: paletteFromEl(panel, props.dark),
    })
    c.setOption(opt, { notMerge: true })
  })

  return (
    <div
      ref={setPanelEl}
      class="border-border-base bg-surface-base flex w-[min(22rem,92vw)] shrink-0 flex-col gap-3 border-l p-3"
    >
      <div class="flex items-start justify-between gap-2">
        <h2 class="text-text-strong text-sm font-medium">{dict["univer.chartDock.title"]}</h2>
        <button
          type="button"
          class="text-text-weak hover:text-text-base rounded-md px-2 py-1 text-xs"
          onClick={() => props.onClose()}
        >
          {dict["univer.chartDock.close"]}
        </button>
      </div>
      <Show when={hint()}>
        {(h) => <p class="text-destructive text-xs">{h()}</p>}
      </Show>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="border-border-base bg-surface-inset-base hover:bg-surface-inset-base-hover rounded-md border px-2 py-1 text-xs"
          onClick={() => pull()}
        >
          {dict["univer.chartDock.refresh"]}
        </button>
      </div>
      <label class="text-text-weak flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={withHeaders()}
          onChange={(e) => setWithHeaders(e.currentTarget.checked)}
        />
        {dict["univer.chartDock.firstRowHeaders"]}
      </label>
      <label class="text-text-weak flex flex-col gap-1 text-xs">
        <span>{dict["univer.chartDock.kind"]}</span>
        <select
          class="border-border-base bg-surface-inset-base text-text-base rounded-md border px-2 py-1"
          value={kind()}
          onChange={(e) => setKind(e.currentTarget.value as ChartKind)}
        >
          <option value="bar">{dict["univer.chartDock.kind.bar"]}</option>
          <option value="line">{dict["univer.chartDock.kind.line"]}</option>
          <option value="stack">{dict["univer.chartDock.kind.stack"]}</option>
          <option value="pie">{dict["univer.chartDock.kind.pie"]}</option>
        </select>
      </label>
      <fieldset class="text-text-weak flex flex-col gap-1 text-xs">
        <legend class="mb-1">{dict["univer.chartDock.orientation"]}</legend>
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="veritly-chart-orient"
            checked={!seriesInRows()}
            onChange={() => setSeriesInRows(false)}
          />
          {dict["univer.chartDock.orientation.cols"]}
        </label>
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="veritly-chart-orient"
            checked={seriesInRows()}
            onChange={() => setSeriesInRows(true)}
          />
          {dict["univer.chartDock.orientation.rows"]}
        </label>
      </fieldset>
      <div
        ref={setChartHost}
        class="border-border-weak-base bg-surface-inset-base min-h-[220px] w-full min-w-0 flex-1 rounded-md border"
      />
    </div>
  )
}
