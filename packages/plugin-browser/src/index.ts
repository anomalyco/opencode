import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { BrowserConnection } from "./connection.js"
import { BrowserTools } from "./tools.js"

export default Plugin.define({
  id: "opencode.browser",
  effect: (ctx) =>
    Effect.gen(function* () {
      // Browser tools exist only for Sessions with an attached desktop.
      yield* BrowserConnection.make(ctx, (attachment) => BrowserTools.register(ctx, attachment))
    }),
})
