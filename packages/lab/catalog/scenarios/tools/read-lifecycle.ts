import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

const screen = (title: string, states: "streaming" | "running" | "success" | "error" | "confirmation") => ({
  title,
  category: "session" as const,
  screenLabels: states === "error" ? (["tool-execution", "error-recovery"] as const) : (["tool-execution"] as const),
  uiElements:
    states === "confirmation"
      ? (["inline-prompt", "approval-actions", "button-group", "keyboard-hints", "confirmation"] as const)
      : (["transcript", "tool-card", "status-indicator"] as const),
  surfaces: "inline" as const,
  patterns: states === "confirmation" ? ("approval" as const) : ("status" as const),
  features: ["tool", "read"] as const,
  states,
})

export const readLifecycleFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "read-file-lifecycle",
    title: "Read file lifecycle",
    group: { id: "tool-use", label: "Tool use" },
    description: "Stream a read call, approve it, then observe success and denial.",
  },
  ({ state, program }) => {
    const input = state("read-input-streaming", {
      screen: screen("Read input streaming", "streaming"),
      step: { title: "Input streams" },
    })
    const permission = state("read-permission", {
      screen: screen("Read permission", "confirmation"),
      step: { title: "Permission is requested" },
    })
    const succeeded = state("read-succeeded", {
      screen: screen("Read succeeded", "success"),
      step: { title: "Read succeeds" },
    })
    const denied = state("read-denied", { screen: screen("Read denied", "error"), step: { title: "Read is denied" } })

    return program([input, permission, succeeded, denied], ({ driver, checkpoint }) =>
      Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.toolCall(
            { index: 0, id: "call_read_success", name: "read", input: { path: "fixture.txt" } },
            { delay: 100, chunkSize: 4 },
          ),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The fixture read succeeded."))
        yield* driver.ui.submit("Read the fixture file.")
        yield* Effect.sleep(350)
        yield* checkpoint(input)
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* checkpoint(permission)
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The fixture read succeeded.", { timeout: 15_000 })
        yield* checkpoint(succeeded)

        yield* driver.llm.queue(
          Llm.toolCall({ index: 0, id: "call_read_failure", name: "read", input: { path: "missing-fixture.txt" } }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The missing-file read failed as expected."))
        yield* driver.ui.submit("Now try to read a missing file.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("The missing-file read failed as expected.", { timeout: 15_000 })
        yield* driver.llm.queue(
          Llm.toolCall({ index: 0, id: "call_read_denied", name: "read", input: { path: "src/ledger.ts" } }),
          Llm.finish("tool-calls"),
        )
        yield* driver.ui.submit("Now read the ledger file.")
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* driver.ui.press("escape")
        yield* driver.ui.waitFor("src/ledger.ts", { timeout: 15_000 })
        yield* checkpoint(denied)
      }),
    )
  },
)
