import type { Univer } from "@univerjs/core"
import type { FUniver } from "@univerjs/core/facade"

type Host = { univer: Univer; univerAPI: FUniver }

let host: Host | undefined

export function bindVeritlyUniverHost(next: Host) {
  host = next
}

export function clearVeritlyUniverHost() {
  host = undefined
}

export function veritlyUniverHost(): Host | undefined {
  return host
}

type ChartUi = { open: () => void }

let chartUi: ChartUi | undefined

export function bindVeritlyChartUi(next: ChartUi) {
  chartUi = next
}

export function clearVeritlyChartUi() {
  chartUi = undefined
}

/** Opens the Veritly ECharts dock when the spreadsheet viewer has registered {@link bindVeritlyChartUi}. */
export function requestVeritlyChartPanel(): boolean {
  const slot = chartUi
  if (!slot) return false
  slot.open()
  return true
}
