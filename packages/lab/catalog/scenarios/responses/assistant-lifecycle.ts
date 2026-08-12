import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

export const assistantLifecycleFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "assistant-lifecycle",
    title: "Assistant response lifecycle",
    group: { id: "responses", label: "Responses" },
    description: "Observe assistant text while it streams, succeeds, fails, and is interrupted.",
  },
  ({ state, program }) => {
    const succeeded = state("assistant-response-succeeded", {
      screen: {
        title: "Assistant response succeeded",
        category: "session",
        screenLabels: ["question-response"],
        uiElements: ["transcript", "confirmation"],
        surfaces: "inline",
        patterns: "status",
        features: ["assistant", "response"],
        states: "success",
      },
      step: { title: "Response succeeds" },
    })
    const failed = state("assistant-response-failed", {
      screen: {
        title: "Assistant response failed",
        category: "session",
        screenLabels: ["question-response", "error-recovery"],
        uiElements: ["transcript", "error-report"],
        surfaces: "inline",
        patterns: "error-report",
        features: ["assistant", "response"],
        states: "error",
      },
      step: { title: "Response fails" },
    })
    const interrupted = state("assistant-response-interrupted", {
      screen: {
        title: "Assistant response interrupted",
        category: "session",
        screenLabels: ["question-response", "error-recovery"],
        uiElements: ["transcript", "status-indicator"],
        surfaces: "inline",
        patterns: "status",
        features: ["assistant", "response"],
        states: "error",
      },
      step: { title: "Response is interrupted" },
    })

    return program(
      [succeeded, failed, interrupted],
      ({ driver, checkpoint }) => Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.text("This assistant response completes successfully."),
        )
        yield* driver.ui.submit("Show a successful streaming assistant response.")
        yield* driver.ui.waitFor("completes successfully.", { timeout: 15_000 })
        yield* checkpoint(succeeded)

        yield* driver.llm.queue(
          Llm.text("This response starts but the simulated provider disconnects.", { delay: 40, chunkSize: 8 }),
          Llm.disconnect(),
        )
        yield* driver.ui.submit("Show a failed assistant response.")
        yield* driver.ui.waitFor("simulated provider disconnects", { timeout: 15_000 })
        yield* Effect.sleep(1_000)
        yield* checkpoint(failed)

        yield* driver.llm.queue(
          Llm.text("This response remains active until the user interrupts it."),
          Llm.pause(30_000),
        )
        yield* driver.ui.submit("Show an interrupted assistant response.")
        yield* driver.ui.waitFor("remains active until", { timeout: 15_000 })
        yield* driver.ui.press("escape")
        yield* driver.ui.press("escape")
        yield* driver.ui.waitFor("interrupted", { timeout: 15_000 })
        yield* checkpoint(interrupted)
      }),
    )
  },
)
