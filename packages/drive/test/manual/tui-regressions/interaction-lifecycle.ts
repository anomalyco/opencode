import { defineScript, Llm } from "../../../src/index.js"
import { Effect } from "effect"

const prompt = "submitted-message-must-render-before-the-model-responds"
const response = "delayed-model-response-arrived"

export default defineScript({
  run: ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* llm.queue(Llm.pause(1_000), Llm.text(response))
      const started = performance.now()
      yield* ui.submit(prompt)
      const submittedIn = performance.now() - started

      if (!(yield* ui.matches(prompt)))
        return yield* Effect.fail(new Error("submitted message was not visible"))
      if (yield* ui.matches(response))
        return yield* Effect.fail(new Error("model response arrived before the submit assertion"))

      yield* ui.waitFor(response, { timeout: 5_000 })

      yield* llm.queue(
        Llm.text("interrupt-me-now"),
        Llm.pause(30_000),
      )
      yield* ui.submit("start-a-response-that-will-be-interrupted")
      yield* ui.waitFor("interrupt-me-now", { timeout: 5_000 })
      yield* ui.press("escape")
      yield* ui.press("escape")
      yield* ui.waitFor("interrupted", { timeout: 5_000 })

      console.log(JSON.stringify({ submittedIn }))
    }),
})
