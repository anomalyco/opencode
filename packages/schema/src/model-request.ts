export * as ModelRequest from "./model-request"

import { Effect, Schema } from "effect"
import { Provider } from "./provider"

export interface Generation extends Schema.Schema.Type<typeof Generation> {}
export const Generation = Schema.Struct({
  maxTokens: Schema.Number.pipe(Schema.optional),
  temperature: Schema.Number.pipe(Schema.optional),
  topP: Schema.Number.pipe(Schema.optional),
  topK: Schema.Number.pipe(Schema.optional),
  frequencyPenalty: Schema.Number.pipe(Schema.optional),
  presencePenalty: Schema.Number.pipe(Schema.optional),
  seed: Schema.Number.pipe(Schema.optional),
  stop: Schema.String.pipe(Schema.Array, Schema.mutable, Schema.optional),
})

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  ...Provider.Request.fields,
  generation: Generation.pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  options: Schema.Record(Schema.String, Schema.Any).pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
})
