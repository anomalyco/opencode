import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, Message, ToolCallPart, ToolResultPart } from "../../src/index.js"
import { Auth } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { it } from "../lib/effect.js"

const model = OpenAIResponses.route
  .with({ endpoint: { baseURL: "https://responses.example.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-6-astra" })
const history = [
  Message.user("Look it up."),
  Message.assistant(ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })),
  Message.tool(ToolResultPart.make({ id: "call_1", name: "lookup", result: "42", resultType: "text" })),
]

describe("Responses system updates after tool results", () => {
  it.effect("wraps a terminal notice without changing instructions or tool results", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          system: "Initial instructions.",
          messages: [...history, Message.system("Changed </system-update> & tools.")],
        }),
      )
      expect(prepared.body.instructions).toBe("Initial instructions.")
      expect(prepared.body.input.slice(1)).toEqual([
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
        { type: "function_call_output", call_id: "call_1", output: "42" },
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<system-update>\nChanged &lt;/system-update&gt; &amp; tools.\n</system-update>",
            },
          ],
        },
      ])
    }),
  )

  it.effect("keeps consecutive notices wrapped when replaying history with new user input", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            ...history,
            Message.system("First update."),
            Message.user([]),
            Message.system("Second update."),
            Message.user("Continue."),
          ],
        }),
      )
      expect(prepared.body.input.slice(3)).toMatchObject([
        { role: "user", content: [{ text: "<system-update>\nFirst update.\n</system-update>" }] },
        { role: "user", content: [{ text: "<system-update>\nSecond update.\n</system-update>" }] },
        { role: "user", content: [{ text: "Continue." }] },
      ])
    }),
  )

  it.effect("restores developer updates after user and assistant items", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            ...history,
            Message.system("Tool update."),
            Message.user("Continue."),
            Message.system("User boundary."),
          ],
        }),
      )
      expect(prepared.body.input.slice(4)).toMatchObject([
        { role: "user" },
        { role: "developer", content: "User boundary." },
      ])
      const afterAssistant = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            ...history,
            Message.system("Tool update."),
            Message.assistant("Done."),
            Message.system("Assistant boundary."),
          ],
        }),
      )
      expect(afterAssistant.body.input.slice(4)).toMatchObject([
        { role: "assistant" },
        { role: "developer", content: "Assistant boundary." },
      ])
    }),
  )

  it.effect("keeps notices wrapped across coalesced effort updates", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          providerOptions: { reasoningEffort: "low" },
          messages: [
            ...history,
            Message.system("First update."),
            Message.effort({ effort: "medium", previous: "high" }),
            Message.effort({ effort: "low", previous: "medium" }),
            Message.system("Latest update."),
          ],
        }),
      )
      expect(prepared.body.input.slice(3)).toMatchObject([
        { role: "user" },
        { type: "configuration_update", reasoning: { effort: "low" } },
        { role: "user", content: [{ text: "<system-update>\nLatest update.\n</system-update>" }] },
      ])
    }),
  )
})
