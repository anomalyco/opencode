import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { BrowserConnection } from "./connection.js"
import { BrowserServe } from "./serve.js"
import { BrowserTools } from "./tools.js"

export default Plugin.define({
  id: "opencode.browser",
  effect: (ctx) =>
    Effect.gen(function* () {
      const connection = yield* BrowserConnection.make(ctx)
      const serve = yield* BrowserServe.make(ctx.location.directory)
      yield* BrowserTools.register(ctx, connection, serve)
    }),
})
