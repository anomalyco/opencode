import { Effect, Schema } from "effect"
import { ai, type ExecutableTool, LLMRequest, toDefinitions, tool, ToolRuntime } from "../src/effect.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { AI } from "../src/index.js"

const request = ai.text.request({
  model: OpenAIChat.route.with({ auth: Auth.bearer("fixture") }).model({ id: "gpt-4o-mini" }),
  prompt: "Use the tool.",
})

const executable = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
  execute: (input) => Effect.succeed({ forecast: input.city }),
})

const schemaOnly = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
})

tool({
  description: "Encode success before projection.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.NumberFromString }),
  execute: () => Effect.succeed({ forecast: 1 }),
  toModelOutput: ({ id, parameters, output }) => [
    { type: "text", text: `${id}:${parameters.city}:${output.forecast}` },
  ],
})

ai.text.stream(request)
ai.text.generate(LLMRequest.update(request, { tools: toDefinitions({ schemaOnly }) }))
ToolRuntime.dispatch({ executable }, { type: "tool-call", id: "call_1", name: "executable", input: { city: "Paris" } })

// @ts-expect-error High-level tool orchestration overloads are intentionally not supported.
ai.text.stream({ request, tools: { schemaOnly } })

const code = Schema.Struct({ code: Schema.String })

tool({
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

tool({
  description: "Run JavaScript.",
  parameters: Schema.Struct({ code: Schema.Number }),
  success: Schema.String,
  // @ts-expect-error A freeform tool's only parameter must be a string.
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

const sum = {
  description: "Add two numbers.",
  parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  success: Schema.Number,
  toModelOutput: ({ output }: { readonly output: number }) => [{ type: "text" as const, text: String(output) }],
}
const declared: AI.Tool<typeof sum.parameters, typeof Schema.Number> = AI.tool(sum)
const effectSum: ExecutableTool = tool({ ...sum, execute: ({ a, b }) => Effect.succeed(a + b) })
const promiseSum: AI.ExecutableTool = AI.tool({ ...sum, execute: async ({ a, b }) => a + b })
toDefinitions({ declared, effectSum, promiseSum, dynamic: AI.tool({ description: "Look up.", jsonSchema: {} }) })

// @ts-expect-error The Effect tool's execute returns an Effect.
tool({ ...sum, execute: ({ a, b }) => a + b })
// @ts-expect-error The execute result must match `success`.
AI.tool({ ...sum, execute: async () => "3" })
