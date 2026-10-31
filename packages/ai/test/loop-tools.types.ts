import { Effect, Schema } from "effect"
import { ai, tool } from "../src/effect.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { AI } from "../src/index.js"

const model = OpenAIChat.route.with({ auth: Auth.bearer("fixture") }).model({ id: "gpt-4o-mini" })

const add = AI.tool({
  name: "add",
  description: "Add two numbers.",
  parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  execute: (input) => input.a + input.b,
})

const echo = AI.tool({
  name: "echo",
  description: "Echo text.",
  parameters: Schema.String,
  execute: (input) => input.toUpperCase(),
})

const weather = tool({
  name: "weather",
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
  execute: (input) => Effect.succeed({ forecast: input.city }),
})

const shout = tool({
  name: "shout",
  description: "Shout text.",
  parameters: Schema.String,
  success: Schema.String,
  execute: (input) => Effect.succeed(input.toUpperCase()),
})

const schemaOnly = tool({
  name: "schemaOnly",
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
})

AI.ai.loop({ model, prompt: "Add 2 and 3.", tools: [add] })
AI.ai.loop({ model, prompt: "Get weather.", tools: [weather] })
AI.ai.loop({ model, prompt: "Use any tool.", tools: [add, echo, weather, shout] })
ai.loop({ model, prompt: "Add 2 and 3.", tools: [add] })
ai.loop({ model, prompt: "Get weather.", tools: [weather] })
ai.loop({ model, prompt: "Use any tool.", tools: [add, echo, weather, shout] })

// @ts-expect-error The loop runs tools, so each one needs an execute handler.
ai.loop({ model, prompt: "Get weather.", tools: [schemaOnly] })

const unavailable = () => {
  throw new Error("Unavailable.")
}
const fail = AI.tool({ name: "fail", description: "Fail.", parameters: Schema.String, execute: unavailable })
const parse = AI.tool({
  name: "parse",
  description: "Parse.",
  parameters: Schema.String,
  execute: (text) => JSON.parse(text),
})
const inspect = tool({
  name: "inspect",
  description: "Inspect.",
  parameters: Schema.String,
  execute: () => Effect.succeed<unknown>(1),
})
AI.ai.loop({ model, prompt: "Fail.", tools: [fail, parse, inspect] })
