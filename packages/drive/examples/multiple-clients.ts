import { Effect, Stream } from "effect"
import { defineScript, Llm } from "opencode-drive"

export default defineScript({
  launch: "manual",

  run: ({ server, tuis, llm }) =>
    Effect.gen(function* () {
      yield* server.launch()

      yield* llm.serve((_request, index) =>
        Stream.make(Llm.text(`Response for request ${index + 1}`)),
      )

      const [alice, bob] = yield* Effect.all(
        [
          tuis.launch("alice", { recording: true }),
          tuis.launch("bob", { recording: true }),
        ],
        { concurrency: "unbounded" },
      )

      yield* Effect.all(
        [alice.ui.submit("Reply to Alice"), bob.ui.submit("Reply to Bob")],
        { concurrency: "unbounded" },
      )
      yield* Effect.all(
        [
          alice.ui.screenshot("multiple-clients-alice-submitted"),
          bob.ui.screenshot("multiple-clients-bob-submitted"),
        ],
        { concurrency: "unbounded" },
      )
      yield* Effect.all(
        [
          alice.ui.waitFor("Response for request", { timeout: 30_000 }),
          bob.ui.waitFor("Response for request", { timeout: 30_000 }),
        ],
        { concurrency: "unbounded" },
      )

      yield* Effect.all(
        [
          alice.ui.screenshot("multiple-clients-alice-complete"),
          bob.ui.screenshot("multiple-clients-bob-complete"),
        ],
        { concurrency: "unbounded" },
      )

      yield* server.kill()
      yield* Effect.sleep(500)
      yield* Effect.all(
        [
          alice.ui.screenshot("multiple-clients-alice-server-stopped"),
          bob.ui.screenshot("multiple-clients-bob-server-stopped"),
        ],
        { concurrency: "unbounded" },
      )

      yield* server.launch()
      yield* Effect.sleep(1000)
      yield* Effect.all(
        [
          alice.ui.screenshot("multiple-clients-alice-server-relaunched"),
          bob.ui.screenshot("multiple-clients-bob-server-relaunched"),
        ],
        { concurrency: "unbounded" },
      )
    }),
})
