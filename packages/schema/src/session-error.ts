export * as SessionError from "./session-error.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

const HttpRateLimitDetails = Schema.Struct({
  retryAfterMs: Schema.Finite.pipe(optional),
  limit: Schema.Record(Schema.String, Schema.String).pipe(optional),
  remaining: Schema.Record(Schema.String, Schema.String).pipe(optional),
  reset: Schema.Record(Schema.String, Schema.String).pipe(optional),
})

const HttpContext = Schema.Struct({
  request: Schema.Struct({
    method: Schema.String,
    url: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  response: Schema.Struct({
    status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
    headers: Schema.Record(Schema.String, Schema.String),
  }).pipe(optional),
  body: Schema.String.pipe(optional),
  bodyTruncated: Schema.Boolean.pipe(optional),
  requestId: Schema.String.pipe(optional),
  rateLimit: HttpRateLimitDetails.pipe(optional),
})

export interface Error extends Schema.Schema.Type<typeof Error> {}
export const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })).pipe(optional),
  http: HttpContext.pipe(optional),
}).annotate({ identifier: "Session.StructuredError" })
