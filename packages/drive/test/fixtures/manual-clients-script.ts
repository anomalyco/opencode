import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"

export default defineScript({
  launch: "manual",
  run: ({ ui, server, tuis, artifacts }) =>
    Effect.gen(function* () {
      if (ui !== null) return yield* Effect.fail(new Error("manual scripts must not receive a default UI"))
      const tuiBeforeServer = yield* Effect.matchEffect(tuis.launch("too-early"), {
        onFailure: (error) => Effect.succeed(errorMessage(error)),
        onSuccess: () => Effect.succeed("unexpected success"),
      })
      const opencode = yield* server.launch()
      const health = yield* opencode.health.get()
      const duplicateServer = yield* Effect.matchEffect(server.launch(), {
        onFailure: (error) => Effect.succeed(errorMessage(error)),
        onSuccess: () => Effect.succeed("unexpected success"),
      })
      const [alice, bob] = yield* Effect.all([tuis.launch("alice"), tuis.launch("bob")], { concurrency: "unbounded" })
      yield* alice.ui.submit("from alice")
      yield* bob.ui.submit("from bob")
      const [aliceMatches, bobMatches, aliceScreenshot, bobScreenshot, aliceFrame] = yield* Effect.all(
        [
          alice.ui.matches("tui-alice"),
          bob.ui.matches("tui-bob"),
          alice.ui.screenshot("alice"),
          bob.ui.screenshot("bob"),
          alice.ui.capture(),
        ],
        { concurrency: "unbounded" },
      )
      yield* Effect.tryPromise(() =>
        Bun.write(
          `${artifacts}/manual-clients.json`,
          JSON.stringify({
            aliceMatches,
            aliceFrame: { cols: aliceFrame.cols, rows: aliceFrame.rows },
            bobMatches,
            apiHealthy: health.healthy,
            tuiBeforeServer,
            duplicateServer,
            aliceScreenshot,
            bobScreenshot,
          }),
        ),
      )
    }),
})

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
