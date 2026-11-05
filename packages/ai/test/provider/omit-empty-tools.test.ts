import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, Message, ToolCallPart } from "../../src/index.js"
import { OpenAIChat } from "../../src/protocols/openai-chat.js"
import { OpenAICompatibleChat } from "../../src/protocols/openai-compatible-chat.js"
import { Auth } from "../../src/route/auth.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

const history = [
  Message.user("Look up the value."),
  Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
  Message.tool({ id: "call_1", name: "lookup", result: "OK", resultType: "text" }),
]

const endpoint = { baseURL: "https://api.openai.test/v1" }
const routes = [
  { name: "openai-chat", route: OpenAIChat.route.with({ endpoint, auth: Auth.bearer("test") }) },
  {
    name: "openai-compatible-chat",
    route: OpenAICompatibleChat.route.with({ provider: "custom", endpoint, auth: Auth.bearer("test") }),
  },
]

for (const { name, route } of routes) {
  const model = (compatibility?: { omitEmptyTools?: boolean }) => route.model({ id: "gpt-4.1-mini", compatibility })

  it.effect(`${name} keeps the empty tools array with tool history by default`, () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({ model: model(), messages: history, tools: [], cache: "none" }),
      )
      expect(prepared.body.tools).toEqual([])
    }),
  )

  it.effect(`${name} omits the tools field when compatibility.omitEmptyTools is set`, () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: model({ omitEmptyTools: true }),
          messages: history,
          tools: [],
          cache: "none",
        }),
      )
      expect(prepared.body.tools).toBeUndefined()
      expect(JSON.stringify(prepared.body)).not.toContain('"tools"')
    }),
  )

  it.effect(`${name} still sends tools with omitEmptyTools when tools are active`, () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: model({ omitEmptyTools: true }),
          prompt: "Look up the value.",
          tools: [{ name: "lookup", description: "Look up a value", inputSchema: { type: "object", properties: {} } }],
          cache: "none",
        }),
      )
      expect(prepared.body.tools).toHaveLength(1)
    }),
  )
}
