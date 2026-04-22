import type { ModelMessage } from "ai"
import { runHiddenJSON, type HiddenJSONModel } from "@/agent/hidden-json"
import z from "zod"

export async function translateJson<S extends z.ZodTypeAny>(input: {
  model: HiddenJSONModel | HiddenJSONModel[]
  messages: ModelMessage[]
  schema: S
}) {
  const result = await runHiddenJSON({
    model: input.model,
    messages: input.messages,
    schema: input.schema,
    toolDescription: "Return the translated JSON payload in the required schema.",
  })
  return result.output
}
