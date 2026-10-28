import { Effect, Schema } from "effect"
import { LLM, LLMRequest, ToolRuntime, toDefinitions } from "../src/effect.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { Tool } from "../src/tool.js"
import { AI } from "../src/index.js"

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

Tool.make({
  description: "Encode success before projection.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.NumberFromString }),
  execute: () => Effect.succeed({ forecast: 1 }),
  toModelOutput: ({ id, parameters, output }) => [
    { type: "text", text: `${id}:${parameters.city}:${output.forecast}` },
  ],
})

LLM.stream(request)
LLM.generate(LLMRequest.update(request, { tools: toDefinitions({ schemaOnly }) }))
ToolRuntime.dispatch({ executable }, { type: "tool-call", id: "call_1", name: "executable", input: { city: "Paris" } })

// @ts-expect-error High-level tool orchestration overloads are intentionally not supported.
LLM.stream({ request, tools: { schemaOnly } })

const code = Schema.Struct({ code: Schema.String })

Tool.make({
  description: "Run JavaScript.",
  parameters: code,
  success: Schema.String,
  freeform: { type: "lark", grammar: 'start: "ZZ" /[0-9]{3}/' },
  execute: (input) => Effect.succeed(input.code),
})

AI.tool({
  description: "Run JavaScript.",
  parameters: code,
  freeform: { type: "regex", pattern: "ZZ[0-9]{3}" },
  execute: (input) => input.code,
})

Tool.make({
  description: "Run JavaScript.",
  // @ts-expect-error A freeform tool's only parameter must be a string.
  parameters: Schema.Struct({ code: Schema.Number }),
  success: Schema.String,
  freeform: { type: "text" },
})

AI.tool({
  description: "Run JavaScript.",
  parameters: Schema.Struct({ code: Schema.String, language: Schema.String }),
  // @ts-expect-error A freeform tool takes exactly one parameter.
  freeform: { type: "text" },
  execute: () => undefined,
})

AI.tool({
  description: "Run JavaScript.",
  parameters: Schema.Struct({ code: Schema.optional(Schema.String) }),
  // @ts-expect-error A freeform tool's parameter must be required.
  freeform: { type: "text" },
  execute: () => undefined,
})
