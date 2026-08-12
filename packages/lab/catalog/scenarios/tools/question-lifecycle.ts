import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

const questions = [
  {
    header: "Runtime",
    question: "Which runtime should the catalog fixture use?",
    options: [
      { label: "Bun", description: "Use the repository's configured runtime." },
      { label: "Node", description: "Use the Node.js compatibility runtime." },
    ],
  },
  {
    header: "Validation",
    question: "Which validation should run?",
    options: [
      { label: "Focused", description: "Run only the focused scenario tests." },
      { label: "Full", description: "Run the complete validation suite." },
    ],
  },
] as const

export const questionLifecycleFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "question-lifecycle",
    title: "Question lifecycle",
    group: { id: "tool-use", label: "Tool use" },
    description: "Stream a question call, answer its form, review it, submit it, and deny a second call.",
  },
  ({ state, program }) => {
    const inputStreaming = state("question-input-streaming", {
      screen: {
        title: "Question input streaming",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["transcript", "tool-card", "status-indicator"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "question"],
        states: "streaming",
      },
      step: { title: "Question input streams" },
    })
    const awaiting = state("question-awaiting-form", {
      screen: {
        title: "Question awaiting form",
        category: "session",
        screenLabels: ["tool-execution", "question-response"],
        uiElements: ["question-prompt", "button-group", "keyboard-hints"],
        surfaces: "inline",
        patterns: "form",
        features: ["tool", "question"],
        states: "pending",
      },
      step: { title: "Question awaits an answer" },
    })
    const review = state("question-review", {
      screen: {
        title: "Question review",
        category: "session",
        screenLabels: ["tool-execution", "question-response"],
        uiElements: ["question-prompt", "confirmation", "keyboard-hints"],
        surfaces: "inline",
        patterns: "form",
        features: ["tool", "question"],
        states: "confirmation",
      },
      step: { title: "Answers are reviewed" },
    })
    const succeeded = state("question-succeeded", {
      screen: {
        title: "Question succeeded",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["transcript", "tool-card", "confirmation"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "question"],
        states: "success",
      },
      step: { title: "Answers are submitted" },
    })
    const denied = state("question-denied", {
      screen: {
        title: "Question denied",
        category: "session",
        screenLabels: ["tool-execution", "error-recovery"],
        uiElements: ["transcript", "tool-card", "destructive-action"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "question"],
        states: "error",
      },
      step: { title: "Question is denied" },
    })

    return program(
      [inputStreaming, awaiting, review, succeeded, denied],
      ({ driver, checkpoint }) => Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.toolCall(
            { index: 0, id: "call_catalog_question", name: "question", input: { questions } },
            { delay: 100, chunkSize: 7 },
          ),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The catalog answers were submitted."))
        yield* driver.ui.submit("Ask me which runtime and validation mode to use.")
        yield* Effect.sleep(450)
        yield* checkpoint(inputStreaming)
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("Which runtime should", { timeout: 15_000 })
        yield* checkpoint(awaiting)
        yield* driver.ui.enter()
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("Review", { timeout: 5_000 })
        yield* checkpoint(review)
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The catalog answers were submitted.", { timeout: 15_000 })
        yield* checkpoint(succeeded)

        yield* driver.llm.queue(
          Llm.toolCall({
            index: 0,
            id: "call_catalog_question_denied",
            name: "question",
            input: { questions: [questions[0]] },
          }),
          Llm.finish("tool-calls"),
        )
        yield* driver.ui.submit("Ask one more runtime question that I will dismiss.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("Which runtime should", { timeout: 15_000 })
        yield* driver.ui.press("escape")
        yield* Effect.sleep(500)
        yield* checkpoint(denied)
      }),
    )
  },
)
