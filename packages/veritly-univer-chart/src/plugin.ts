import type { FUniver } from "@univerjs/core/facade"
import { Inject, Injector, Plugin, UniverInstanceType } from "@univerjs/core"
import { MessageType } from "@univerjs/design"
import type { IFacadeMenuItem, IFUniverUIMixin } from "@univerjs/ui/facade"
import { IMessageService, RibbonInsertGroup } from "@univerjs/ui"
import { createUniverSdk, type UniverSdkRuntime } from "@opencode-ai/univer-sdk"
import { activeSheetSelectionRange } from "./sheet-chart-range"
import { veritlyChartHost } from "./runtime-host"

const MENU_ID = "veritly-insert-chart"

const copy = {
  insert: "Chart",
  insertHint:
    "Insert a live chart on the sheet from the current selection. The chart updates when those cells change (default is a bar chart).",
  noWorkbook: "No active workbook.",
  noSheet: "No active sheet.",
  added: "Live chart added on the sheet.",
}

/**
 * Ribbon Insert → Chart: live ECharts float (`VERITLY_LIVE_CHART`) backed by the chart runtime host.
 */
export class VeritlyLiveChartPlugin extends Plugin {
  static override pluginName = "VERITLY_LIVE_CHART_GLUE"
  static override packageName = "@opencode-ai/veritly-univer-chart"
  /** Must match `dependencies["@univerjs/core"]` in this package (PluginService assertion). */
  static override version = "0.18.0"
  static override type = UniverInstanceType.UNIVER_SHEET

  private registered = false

  /** First arg is plugin options from `PluginService`; Redi injects after custom args. */
  constructor(_opts: unknown, @Inject(Injector) protected readonly _injector: Injector) {
    super()
  }

  override onStarting(): void {}

  override onSteady(): void {
    if (this.registered) return
    const slot = veritlyChartHost()
    if (!slot) return
    const api = slot.univerAPI as FUniver & IFUniverUIMixin
    const msg = this._injector.get(IMessageService)

    const insert = async () => {
      const cur = veritlyChartHost()
      if (!cur) return
      const wb = cur.univerAPI.getActiveWorkbook?.()
      if (!wb) {
        msg.show({ content: copy.noWorkbook, type: MessageType.Warning })
        return
      }
      const sh = wb.getActiveSheet()
      if (!sh) {
        msg.show({ content: copy.noSheet, type: MessageType.Warning })
        return
      }
      const sdk = createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer } as unknown as UniverSdkRuntime)
      const range = activeSheetSelectionRange(cur.univerAPI as FUniver)
      try {
        await sdk.addChart({ range })
        msg.show({ content: copy.added, type: MessageType.Success })
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e)
        msg.show({ content: text, type: MessageType.Error })
      }
    }

    const item: IFacadeMenuItem = {
      id: MENU_ID,
      title: copy.insert,
      tooltip: copy.insertHint,
      order: 50,
      action: () => {
        void insert()
      },
    }
    api.createMenu(item).appendTo(RibbonInsertGroup.MEDIA)
    this.registered = true
  }
}
