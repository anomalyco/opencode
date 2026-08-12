import { defineScript, Llm } from "../../../src/index.js"
import { Config, Effect } from "effect"

export default defineScript({
  launch: "manual",
  run: ({ server, tuis, llm, artifacts }) =>
    Effect.gen(function* () {
      yield* Config.string("OPENCODE_DRIVE_DB")
      yield* server.launch()
      const tui = yield* tuis.launch("restart-regression")

      yield* llm.queue(Llm.text("before-restart-response"))
      yield* tui.ui.submit("before-restart-prompt")
      yield* tui.ui.waitFor("before-restart-response", { timeout: 5_000 })

      yield* server.kill()
      yield* server.launch()

      yield* Effect.sleep(3_000)
      const frame = yield* tui.ui.capture()
      yield* Effect.tryPromise(() =>
        Bun.write(`${artifacts}/after-restart.frame.json`, JSON.stringify(frame, null, 2)),
      )

      yield* tui.ui.waitFor("before-restart-prompt", { timeout: 5_000 })
      yield* llm.queue(Llm.text("after-restart-response"))
      yield* tui.ui.submit("after-restart-prompt")
      yield* tui.ui.waitFor("after-restart-response", { timeout: 5_000 })
    }),
})
