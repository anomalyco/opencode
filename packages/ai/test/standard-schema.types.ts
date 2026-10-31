import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { Effect } from "effect"
import * as v from "valibot"
import { z } from "zod"
import { ai, tool } from "../src/effect.js"
import { AI } from "../src/index.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"

const model = OpenAIChat.route.with({ auth: Auth.bearer("fixture") }).model({ id: "gpt-4o-mini" })

tool({
  name: "weather",
  description: "Get the weather.",
  input: z.object({ days: z.string().transform(Number) }),
  execute: (input) => Effect.succeed(input.days satisfies number),
})

AI.tool({
  name: "weather",
  description: "Get the weather.",
  input: toStandardJsonSchema(v.object({ city: v.string() })),
  // @ts-expect-error `city` is a string.
  execute: (input) => input.city satisfies number,
})

AI.tool({
  name: "run_code",
  description: "Run JavaScript.",
  input: z.object({ code: z.string() }),
  freeform: { type: "text" },
})

ai.generate({ model, prompt: "Pick a city.", schema: z.object({ city: z.string() }) }).pipe(
  Effect.map((response) => response.object.city satisfies string),
)

AI.ai
  .generate({ model, prompt: "Pick a city.", schema: z.object({ city: z.string() }) })
  .then((response) => response.object.city satisfies string)
