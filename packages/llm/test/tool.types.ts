import { Effect, Schema } from "effect"
import { LLM, LLMRequest, ToolRuntime, toDefinitions } from "../src"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { Auth } from "../src/route"
import { Tool } from "../src/tool"

const request = LLM.request({
  model: OpenAIChat.route.with({ auth: Auth.bearer("fixture") }).model({ id: "gpt-4o-mini" }),
  prompt: "Use the tool.",
})

const executable = Tool.make({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
  execute: (input) => Effect.succeed({ forecast: input.city }),
})

const schemaOnly = Tool.make({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
})

LLM.stream(request)
LLM.generate(LLMRequest.update(request, { tools: toDefinitions({ schemaOnly }) }))
ToolRuntime.dispatch({ executable }, { type: "tool-call", id: "call_1", name: "executable", input: { city: "Paris" } })

// @ts-expect-error High-level tool orchestration overloads are intentionally not supported.
LLM.stream({ request, tools: { schemaOnly } })
