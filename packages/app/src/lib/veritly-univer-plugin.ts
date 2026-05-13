import type { FUniver } from "@univerjs/core/facade"
import { Inject, Injector, Plugin, UniverInstanceType } from "@univerjs/core"
import { MessageType } from "@univerjs/design"
import type { IFacadeMenuItem, IFUniverUIMixin } from "@univerjs/ui/facade"
import { IMessageService, RibbonInsertGroup } from "@univerjs/ui"
import { VERITLY_LIVE_CHART, createUniverSdk, type UniverSdkRuntime } from "@opencode-ai/univer-sdk"
import { dict } from "@/i18n/en"
import { activeSheetSelectionRange } from "@/lib/sheet-chart-range"
import { VeritlyLiveChartFloat } from "@/lib/veritly-live-chart-float"
import { veritlyUniverHost } from "@/lib/veritly-univer-runtime"

const MENU_ID = "veritly-insert-chart"

/**
 * Veritly-specific Univer wiring: ribbon Insert → Chart inserts a drawing with a live ECharts float (`VERITLY_LIVE_CHART`).
 */
export class VeritlyUniverGluePlugin extends Plugin {
  static override pluginName = "VERITLY_UNIVER_GLUE"
  static override packageName = "@opencode-ai/app"
  /** Must match `dependencies["@univerjs/core"]` in this package (PluginService assertion). */
  static override version = "0.18.0"
  static override type = UniverInstanceType.UNIVER_SHEET

  private registered = false

  constructor(@Inject(Injector) protected readonly _injector: Injector) {
    super()
  }

  override onStarting(): void {}

  override onSteady(): void {
    if (this.registered) return
    const slot = veritlyUniverHost()
    if (!slot) return
    const api = slot.univerAPI as FUniver & IFUniverUIMixin
    const msg = this._injector.get(IMessageService)

    this.disposeWithMe(api.registerComponent(VERITLY_LIVE_CHART, VeritlyLiveChartFloat))

    const insert = async () => {
      const cur = veritlyUniverHost()
      if (!cur) return
      const wb = cur.univerAPI.getActiveWorkbook?.()
      if (!wb) {
        msg.show({ content: dict["univer.insertChart.noWorkbook"], type: MessageType.Warning })
        return
      }
      const sh = wb.getActiveSheet()
      if (!sh) {
        msg.show({ content: dict["univer.insertChart.noSheet"], type: MessageType.Warning })
        return
      }
      const sdk = createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer } as unknown as UniverSdkRuntime)
      const range = activeSheetSelectionRange(cur.univerAPI as FUniver)
      try {
        await sdk.addChart({ range })
        msg.show({ content: dict["univer.insertChart.added"], type: MessageType.Success })
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e)
        msg.show({ content: text, type: MessageType.Error })
      }
    }

    const item: IFacadeMenuItem = {
      id: MENU_ID,
      title: dict["univer.insertChart"],
      tooltip: dict["univer.insertChart.tooltip"],
      order: 50,
      action: () => {
        void insert()
      },
    }
    api.createMenu(item).appendTo(RibbonInsertGroup.MEDIA)
    this.registered = true
  }
}
