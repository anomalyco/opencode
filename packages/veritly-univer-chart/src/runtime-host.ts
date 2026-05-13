import type { Univer } from "@univerjs/core"
import type { FUniver } from "@univerjs/core/facade"

export type ChartHost = { univer: Univer; univerAPI: FUniver }

let slot: ChartHost | undefined

export function bindVeritlyChartHost(next: ChartHost) {
  slot = next
}

export function clearVeritlyChartHost() {
  slot = undefined
}

export function veritlyChartHost(): ChartHost | undefined {
  return slot
}
