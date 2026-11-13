export * as UnarySse from "./unary-sse.js"

import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"

/**
 * Marks an SSE response that carries exactly one data event. Generated clients expose it as a one-shot call that
 * resolves to that event, while the server keeps the connection alive with heartbeat comments until it is ready.
 * `@opencode/httpapi-codegen` reads this annotation as `unarySseAnnotation`.
 */
export const annotation = "httpapi.unarySse"

const dataSchemas = new WeakMap<Schema.Top, Schema.Top>()

export const make = <Data extends Schema.Top>(data: Data) => {
  const schema = HttpApiSchema.StreamSse({ data }).annotate({ [annotation]: true })
  dataSchemas.set(schema, data)
  return schema
}

/** The schema of the one data event, for callers that return it directly rather than as a stream. */
export const data = (schema: Schema.Top) => dataSchemas.get(schema)
