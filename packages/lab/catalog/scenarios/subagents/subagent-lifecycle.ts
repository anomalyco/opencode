import { Effect, Stream } from "effect"
import { Llm, type JsonValue } from "opencode-drive"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

export const subagentLifecycleFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "subagent-lifecycle",
    title: "Subagent lifecycle",
    group: { id: "subagents", label: "Subagents" },
    description: "Delegate work, observe its completion, and open the child session.",
  },
  ({ state, program }) => {
    const running = state("subagent-running", {
      screen: {
        title: "Subagent running",
        category: "session",
        screenLabels: ["subagent-activity"],
        uiElements: ["transcript", "tool-card", "status-indicator"],
        surfaces: "inline",
        patterns: "status",
        features: ["agent", "subagent"],
        states: "running",
      },
      step: { title: "Subagent runs" },
    })
    const completed = state("subagent-completed", {
      screen: {
        title: "Subagent completed",
        category: "session",
        screenLabels: ["subagent-activity"],
        uiElements: ["transcript", "tool-card", "confirmation"],
        surfaces: "inline",
        patterns: "status",
        features: ["agent", "subagent"],
        states: "success",
      },
      step: { title: "Subagent completes" },
    })
    const session = state("subagent-session", {
      screen: {
        title: "Subagent session",
        category: "session",
        screenLabels: ["subagent-activity", "session-list"],
        uiElements: ["transcript", "panel", "status-indicator"],
        surfaces: ["full-screen", "panel"],
        patterns: "status",
        features: ["agent", "subagent", "session"],
        states: "populated",
      },
      step: { title: "Open the subagent session" },
    })

    return program([running, completed, session], ({ driver, checkpoint }) =>
      Effect.gen(function* () {
        let phase = 0
        yield* driver.llm.serve((request) => {
          if (JSON.stringify(request.body).includes("title generator")) {
            return Stream.make(Llm.text("Delegating ledger lifecycle"))
          }
          if (phase === 0) {
            phase++
            const tool = subagentTool(request.body)
            return Stream.make(
              Llm.reasoning("I will delegate the ledger inspection."),
              Llm.toolCall({
                index: 0,
                id: "call_catalog_subagent",
                name: tool,
                input: subagentInput(tool),
              }),
              Llm.finish("tool-calls"),
            )
          }
          if (phase === 1) {
            phase++
            return Stream.make(Llm.pause(1_500), Llm.text("The child inspected src/ledger.ts and calculated total 42."))
          }
          phase++
          return Stream.make(Llm.text("Subagent completed the ledger lifecycle."))
        })

        yield* driver.ui.submit("Use a subagent to inspect src/ledger.ts and calculate the total.")
        yield* driver.ui.waitFor("Inspect ledger lifecycle", { timeout: 15_000 })
        yield* checkpoint(running)
        yield* driver.ui.waitFor("Subagent completed the ledger lifecycle.", { timeout: 30_000 })
        yield* checkpoint(completed)
        yield* driver.ui.press("p", { ctrl: true })
        yield* driver.ui.waitFor("Commands")
        yield* driver.ui.type("Toggle subagent picker")
        yield* driver.ui.waitFor("Toggle subagent picker")
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("Subagents")
        yield* driver.ui.press("a", { ctrl: true })
        yield* driver.ui.waitFor("Inspect ledger lifecycle")
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("calculated total 42", { timeout: 15_000 })
        yield* checkpoint(session)
      }),
    )
  },
)

function subagentTool(body: JsonValue) {
  const names = offeredTools(body)
  if (names.includes("subagent")) return "subagent"
  if (names.includes("task")) return "task"
  throw new Error(`OpenCode did not offer a subagent tool: ${names.join(", ")}`)
}

function subagentInput(tool: string): JsonValue {
  const input = {
    description: "Inspect ledger lifecycle",
    prompt: "Read src/ledger.ts and report its exports, values, and calculated total.",
  }
  if (tool === "subagent") return { ...input, agent: "researcher" }
  return { ...input, subagent_type: "researcher" }
}

function offeredTools(body: JsonValue) {
  if (!isJsonObject(body) || !Array.isArray(body.tools)) return []
  return body.tools.flatMap((tool) => {
    if (!isJsonObject(tool) || !isJsonObject(tool.function)) return []
    return typeof tool.function.name === "string" ? [tool.function.name] : []
  })
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
