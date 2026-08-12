import { defineScript, Llm } from "../../../src/index.js"
import { Effect } from "effect"

const question = {
  question: "Which runtime should the restart regression use?",
  header: "Runtime",
  options: [
    { label: "Bun", description: "Use Bun for the regression." },
    { label: "Node", description: "Use Node for the regression." },
  ],
  multiple: false,
}

export default defineScript({
  launch: "manual",
  run: ({ server, tuis, llm, artifacts }) =>
    Effect.gen(function* () {
      yield* server.launch()
      const tui = yield* tuis.launch("pending-form-restart")
      yield* llm.queue(
        Llm.toolCall({
          index: 0,
          id: "call_pending_form_restart",
          name: "question",
          input: { questions: [question] },
        }),
        Llm.finish("tool-calls"),
      )
      yield* tui.ui.submit("Ask one runtime question and wait for my answer.")
      yield* tui.ui.waitFor(question.question, { timeout: 15_000 })

      yield* server.kill()
      yield* server.launch()
      yield* Effect.sleep(3_000)
      if (!(yield* tui.ui.matches(question.question))) return
      yield* llm.queue(Llm.text("restart-form-answer-accepted"))
      yield* tui.ui.enter()
      yield* tui.ui.enter()
      yield* tui.ui.waitFor("Review", { timeout: 5_000 })
      yield* tui.ui.enter()
      yield* Effect.sleep(1_000)

      if (yield* tui.ui.matches("Form not found")) {
        const frame = yield* tui.ui.capture()
        yield* Effect.tryPromise(() =>
          Bun.write(`${artifacts}/stale-form.frame.json`, JSON.stringify(frame, null, 2)),
        )
        return yield* Effect.fail(new Error("pending form became stale after server restart"))
      }
      yield* tui.ui.waitFor("restart-form-answer-accepted", { timeout: 15_000 })
    }),
})
