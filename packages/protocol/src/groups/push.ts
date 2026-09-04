import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError, InvalidRequestError, ServiceUnavailableError } from "../errors.js"

export const PushSubscriptionID = Schema.String.check(Schema.isUUID())

export const PushSubscription = Schema.Struct({
  id: PushSubscriptionID,
  endpoint: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  keys: Schema.Struct({
    p256dh: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{87}$/)),
    auth: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22}$/)),
  }),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  notifications: Schema.Struct({ agent: Schema.Boolean, errors: Schema.Boolean }),
  titles: Schema.Struct({
    agent: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    errors: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  }),
})
export type PushSubscription = typeof PushSubscription.Type

export const PushGroup = HttpApiGroup.make("server.push")
  .add(
    HttpApiEndpoint.get("push.get", "/api/push", {
      success: Schema.Struct({ publicKey: Schema.String }),
      error: ServiceUnavailableError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.push.get", summary: "Get the Web Push public key" })),
  )
  .add(
    HttpApiEndpoint.put("push.subscribe", "/api/push/subscription", {
      payload: PushSubscription,
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.push.subscribe",
        summary: "Register or update a browser push subscription",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("push.unsubscribe", "/api/push/subscription/:id", {
      params: { id: PushSubscriptionID },
      success: HttpApiSchema.NoContent,
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.push.unsubscribe", summary: "Remove a browser push subscription" }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "push" }))
