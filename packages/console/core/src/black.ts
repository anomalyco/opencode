import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"

export namespace BlackData {
  const Schema = z.object({
    fixedLimit: z.number().int(),
    rollingLimit: z.number().int(),
    rollingWindow: z.number().int(),
  })

  export const validate = fn(Schema, (input) => {
    return input
  })

  export const get = fn(z.void(), () => {
    const json = JSON.parse(Resource.ZEN_BLACK.value)
    return Schema.parse(json)
  })
}
