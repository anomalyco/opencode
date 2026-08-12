import { defineScript } from "../../../src/index.js"
import { Effect } from "effect"

const outage = Number(process.env.OPENCODE_DRIVE_OUTAGE_MS ?? 20_000)

export default defineScript({
  launch: "manual",
  run: ({ server, tuis }) =>
    Effect.gen(function* () {
      yield* server.launch()
      const tui = yield* tuis.launch("reconnect-outage")
      yield* tui.ui.waitFor("Ask anything", { timeout: 15_000 })

      yield* server.kill()
      yield* Effect.sleep(outage)
      yield* server.launch()

      yield* tui.ui.waitFor("Ask anything", { timeout: 60_000 })
    }),
})
