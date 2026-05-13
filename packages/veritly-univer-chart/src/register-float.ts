import type { FUniver } from "@univerjs/core/facade"
import type { IFUniverUIMixin } from "@univerjs/ui/facade"
import { VERITLY_LIVE_CHART } from "@opencode-ai/univer-sdk"
import { VeritlyLiveChartFloat } from "./live-chart-float"

/** Call right after `createUniver` so persisted `VeritlyLiveChart` drawings can mount (before `loadServerUnit`). */
export function registerVeritlyLiveChartFloat(api: FUniver & IFUniverUIMixin) {
  return api.registerComponent(VERITLY_LIVE_CHART, VeritlyLiveChartFloat)
}
