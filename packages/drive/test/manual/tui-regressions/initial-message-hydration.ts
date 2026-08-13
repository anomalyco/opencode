import { defineScript, Llm } from "../../../src/index.js"
import { Effect } from "effect"

const attempts = Number(process.env.OPENCODE_DRIVE_ATTEMPTS ?? 20)

export default defineScript({
  launch: "manual",
  run: ({ server, tuis, llm, artifacts }) =>
    Effect.gen(function* () {
      yield* server.launch()
      for (let index = 0; index < attempts; index++) {
        const prompt = `initial-user-message-${index}`
        const response = `assistant-response-${index}`
        yield* llm.queue(Llm.text(response, { delay: 0, chunkSize: 100 }))
        const tui = yield* tuis.launch(`initial-message-${index}`)
        yield* tui.ui.submit(prompt)
        yield* tui.ui.waitFor(response, { timeout: 10_000 })
        if (!(yield* tui.ui.matches(prompt))) {
          const frame = yield* tui.ui.capture()
          yield* Effect.tryPromise(() =>
            Bun.write(`${artifacts}/missing-initial-message.frame.json`, JSON.stringify(frame, null, 2)),
          )
          return yield* Effect.fail(new Error(`initial message disappeared on attempt ${index + 1}`))
        }
        yield* tui.close()
      }
      yield* server.kill()
      console.log(JSON.stringify({ attempts }))
    }),
})
