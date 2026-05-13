import type { FUniver } from "@univerjs/core/facade"
import { Inject, Injector, Plugin, UniverInstanceType } from "@univerjs/core"
import { MessageType } from "@univerjs/design"
import type { IFacadeMenuItem, IFUniverUIMixin } from "@univerjs/ui/facade"
import { IMessageService, RibbonInsertGroup } from "@univerjs/ui"
import { dict } from "@/i18n/en"
import { requestVeritlyChartPanel, veritlyUniverHost } from "@/lib/veritly-univer-runtime"

const MENU_ID = "veritly-insert-chart"

/**
 * Veritly-specific Univer wiring: ribbon Insert → Chart opens the Veritly ECharts dock (see {@link requestVeritlyChartPanel}).
 * Runtime is bound from {@link bindVeritlyUniverHost} in the spreadsheet viewer after `createUniver`.
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

    const insert = () => {
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
      if (requestVeritlyChartPanel()) return
      msg.show({ content: dict["univer.insertChart.panelUnavailable"], type: MessageType.Warning })
    }

    const item: IFacadeMenuItem = {
      id: MENU_ID,
      title: dict["univer.insertChart"],
      tooltip: dict["univer.insertChart.tooltip"],
      order: 50,
      action: () => {
        insert()
      },
    }
    api.createMenu(item).appendTo(RibbonInsertGroup.MEDIA)
    this.registered = true
  }
}
