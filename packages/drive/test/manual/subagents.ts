import { defineScript, Llm, type JsonValue, type Ui } from "../../src/index.js"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

export default defineScript({
  setup: ({ fs }) => fs.writeFile(
    "src/ledger.ts",
    [
      "export const credits = [8, 13, 21]",
      "export const total = credits.reduce((sum, value) => sum + value, 0)",
      "",
    ].join("\n"),
  ),

  run: ({ llm, ui }) =>
    Effect.gen(function* () {
      let phase = 0

      yield* llm.serve((request) => {
        if (isTitleRequest(request.body)) {
          return Stream.make(Llm.text("Delegating ledger checks"))
        }

        if (phase === 0 || phase === 3) {
          const tool = subagentTool(request.body)
          const first = phase === 0
          phase++
          return Stream.make(
            Llm.reasoning(
              first
                ? "I will delegate repository inspection to an explore agent."
                : "I will ask a general agent to independently verify the result.",
            ),
            Llm.toolCall({
              index: 0,
              id: first ? "call_explore_ledger" : "call_verify_ledger",
              name: tool,
              input: subagentInput(
                tool,
                first ? "Explore the ledger" : "Verify the total",
                first
                  ? "Read src/ledger.ts and report its exports and values."
                  : "Independently calculate the total exported by src/ledger.ts.",
                first ? "explore" : "general",
              ),
            }),
            Llm.finish("tool-calls"),
          )
        }

        if (phase === 1) {
          phase++
          return Stream.make(
            Llm.text(
              "The ledger exports credits containing 8, 13, and 21, plus a computed total.",
            ),
          )
        }
        if (phase === 2) {
          phase++
          return Stream.make(
            Llm.text(
              "First delegation complete: the explore agent inspected the ledger.",
            ),
          )
        }
        if (phase === 4) {
          phase++
          return Stream.make(
            Llm.text("The independent calculation is 8 + 13 + 21 = 42."),
          )
        }

        phase++
        return Stream.make(
          Llm.text(
            "Second delegation complete: the general agent confirmed total 42.",
          ),
        )
      })

      yield* ui.submit("Use an explore subagent to inspect src/ledger.ts.")
      yield* ui.waitFor("First delegation complete", { timeout: 30_000 })
      yield* Effect.sleep(250)
      yield* ui.screenshot("subagents-first-complete")

      yield* openSubagents(ui)
      yield* ui.waitFor("Subagents")
      yield* ui.enter()
      yield* ui.screenshot("subagents-child")
      yield* ui.press("escape")
      yield* ui.waitFor("First delegation complete")

      yield* ui.submit("Now use a general subagent to verify the total independently.")
      yield* ui.waitFor("Second delegation complete", { timeout: 30_000 })
      yield* Effect.sleep(250)
      yield* ui.screenshot("subagents-second-complete")
    }),
})

const openSubagents = Effect.fn("openSubagents")(function* (ui: Ui) {
  yield* ui.press("x", { ctrl: true })
  yield* ui.arrow("down")
})

function subagentTool(body: JsonValue) {
  const names = offeredTools(body)
  if (names.includes("subagent")) return "subagent"
  if (names.includes("task")) return "task"
  throw new Error(`OpenCode did not offer a subagent tool: ${names.join(", ")}`)
}

function subagentInput(
  tool: string,
  description: string,
  prompt: string,
  agent: string,
): JsonValue {
  if (tool === "subagent") return { agent, description, prompt }
  return { subagent_type: agent, description, prompt }
}

function offeredTools(body: JsonValue) {
  if (!isJsonObject(body)) return []
  const tools = body.tools
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool) => {
    if (!isJsonObject(tool)) return []
    const definition = tool.function
    if (!isJsonObject(definition) || typeof definition.name !== "string") return []
    return [definition.name]
  })
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTitleRequest(body: unknown) {
  return JSON.stringify(body).includes("title generator")
}
