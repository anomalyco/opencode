import { Injector, Plugin, UniverInstanceType } from "@univerjs/core"

/**
 * Extension point for Veritly-specific Univer wiring (menus, commands, auth).
 * Resolve services via `this._injector` in lifecycle hooks — e.g. menu APIs when adding ribbon entries.
 */
export class VeritlyUniverGluePlugin extends Plugin {
  static override pluginName = "VERITLY_UNIVER_GLUE"
  static override packageName = "@opencode-ai/app"
  /** Must match `dependencies["@univerjs/core"]` in this package (PluginService assertion). */
  static override version = "0.18.0"
  static override type = UniverInstanceType.UNIVER_SHEET

  protected readonly _injector: Injector

  constructor(injector: Injector) {
    super()
    this._injector = injector
  }

  override onStarting(): void {
    void this._injector
  }
}
