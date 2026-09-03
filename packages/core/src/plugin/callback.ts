export * as PluginCallback from "./callback.js"

import { Data } from "effect"

/** Local failure detail. Transport boundaries must explicitly select public fields. */
export class Error extends Data.TaggedError("PluginCallbackError")<{
  readonly pluginID: string
  readonly operation: "skill.transform"
  readonly cause: unknown
}> {
  override get message() {
    return `Plugin "${this.pluginID}" failed during ${this.operation}.`
  }
}
