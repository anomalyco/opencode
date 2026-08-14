import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

export const shellLifecycleFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "shell-lifecycle",
    title: "Foreground shell lifecycle",
    group: { id: "tool-use", label: "Tool use" },
    description: "Watch thinking and shell input stream before foreground commands succeed and fail.",
  },
  ({ state, program }) => {
    const thinkingStreaming = state("thinking-streaming", {
      screen: {
        title: "Thinking streaming",
        category: "session",
        screenLabels: ["shell-activity"],
        uiElements: ["transcript", "status-indicator"],
        surfaces: "inline",
        patterns: "status",
        features: ["thinking", "shell"],
        states: "streaming",
      },
      step: { title: "Thinking streams" },
    })
    const inputStreaming = state("shell-input-streaming", {
      screen: {
        title: "Shell input streaming",
        category: "session",
        screenLabels: ["tool-execution", "shell-activity"],
        uiElements: ["transcript", "tool-card", "terminal-output", "status-indicator"],
        surfaces: "inline",
        patterns: "terminal",
        features: ["tool", "shell"],
        states: "streaming",
      },
      step: { title: "Command input streams" },
    })
    const outputStreaming = state("shell-output-streaming", {
      screen: {
        title: "Shell output streaming",
        category: "session",
        screenLabels: ["tool-execution", "shell-activity"],
        uiElements: ["transcript", "tool-card", "terminal-output", "status-indicator"],
        surfaces: "inline",
        patterns: "terminal",
        features: ["tool", "shell"],
        states: ["running", "streaming"],
      },
      step: { title: "Command output streams" },
    })
    const succeeded = state("shell-execute-succeeded", {
      screen: {
        title: "Shell execution succeeded",
        category: "session",
        screenLabels: ["tool-execution", "shell-activity"],
        uiElements: ["transcript", "tool-card", "terminal-output", "confirmation"],
        surfaces: "inline",
        patterns: "terminal",
        features: ["tool", "shell"],
        states: "success",
      },
      step: { title: "Command succeeds" },
    })
    const failed = state("shell-execute-failed", {
      screen: {
        title: "Shell execution failed",
        category: "session",
        screenLabels: ["tool-execution", "shell-activity", "error-recovery"],
        uiElements: ["transcript", "tool-card", "terminal-output", "error-report"],
        surfaces: "inline",
        patterns: ["terminal", "error-report"],
        features: ["tool", "shell"],
        states: "error",
      },
      step: { title: "Command fails" },
    })

    return program([thinkingStreaming, inputStreaming, outputStreaming, succeeded, failed], ({ driver, checkpoint }) =>
      Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.reasoning("I will inspect the foreground shell lifecycle before running the command.", {
            delay: 70,
            chunkSize: 7,
          }),
          Llm.toolCall(
            {
              index: 0,
              id: "call_catalog_shell_success",
              name: "shell",
              input: { command: "printf catalog-shell-success" },
            },
            { delay: 90, chunkSize: 5 },
          ),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The successful shell command completed."))

        yield* driver.ui.submit("Run one successful foreground shell command.")
        yield* Effect.sleep(250)
        yield* checkpoint(thinkingStreaming)
        yield* driver.ui.waitFor("Writing command...", { timeout: 15_000 })
        yield* checkpoint(inputStreaming)
        yield* driver.ui.waitFor("printf catalog-shell-success", { timeout: 15_000 })
        yield* checkpoint(outputStreaming)
        yield* driver.ui.waitFor("The successful shell command completed.", { timeout: 15_000 })
        yield* checkpoint(succeeded)

        yield* driver.llm.queue(
          Llm.toolCall({
            index: 0,
            id: "call_catalog_shell_failure",
            name: "shell",
            input: { command: "catalog-shell-fail" },
          }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The shell lifecycle is complete."))
        yield* driver.ui.submit("Now run one failing foreground shell command.")
        yield* driver.ui.waitFor("The shell lifecycle is complete.", { timeout: 15_000 })
        yield* checkpoint(failed)
      }),
    )
  },
)
