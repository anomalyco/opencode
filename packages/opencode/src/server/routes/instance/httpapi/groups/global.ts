import { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceDisposed } from "@/server/event"
import "@opencode-ai/core/account"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
})

const SyncEventSchemas = EventV2.registry
  .values()
  .flatMap((definition) => {
    if (!definition.sync) return []
    return [
      Schema.Struct({
        type: Schema.Literal("sync"),
        id: EventV2.ID,
        syncEvent: Schema.Struct({
          type: Schema.Literal(EventV2.versionedType(definition.type, definition.sync.version)),
          id: EventV2.ID,
          seq: Schema.Finite,
          aggregateID: Schema.String,
          data: definition.data,
        }),
      }).annotate({ identifier: `SyncEvent.${definition.type}` }),
    ]
  })
  .toArray()

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([
    ...EventV2.registry
      .values()
      .map((definition) =>
        Schema.Struct({ id: EventV2.ID, type: Schema.Literal(definition.type), properties: definition.data }),
      )
      .toArray(),
    InstanceDisposed,
    ...SyncEventSchemas,
  ]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.optional(Schema.String),
})

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

const PushPublicKey = Schema.Struct({
  supported: Schema.Boolean,
  publicKey: Schema.NullOr(Schema.String),
}).annotate({ identifier: "PushPublicKey" })

const PushSubscription = Schema.Struct({
  id: Schema.String,
  deviceLabel: Schema.optional(Schema.String),
  endpoint: Schema.String,
  expirationTime: Schema.optional(Schema.NullOr(Schema.Number)),
  enabled: Schema.Boolean,
  failureCount: Schema.Number,
  lastError: Schema.optional(Schema.String),
  lastFailureAt: Schema.optional(Schema.NullOr(Schema.Number)),
  lastSuccessAt: Schema.optional(Schema.NullOr(Schema.Number)),
  notifyOnCompletion: Schema.Boolean,
  notifyOnError: Schema.Boolean,
  serverOrigin: Schema.String,
  userAgent: Schema.optional(Schema.String),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "PushSubscription" })

const PushSubscriptionUpsert = Schema.Struct({
  deviceLabel: Schema.optional(Schema.String),
  endpoint: Schema.String,
  expirationTime: Schema.optional(Schema.NullOr(Schema.Number)),
  keys: Schema.Struct({
    auth: Schema.String,
    p256dh: Schema.String,
  }),
  enabled: Schema.optional(Schema.Boolean),
  notifyOnCompletion: Schema.optional(Schema.Boolean),
  notifyOnError: Schema.optional(Schema.Boolean),
  serverOrigin: Schema.String,
  userAgent: Schema.optional(Schema.String),
})

const PushSubscriptionUpdate = Schema.Struct({
  deviceLabel: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
})

const PushTestInput = Schema.Struct({
  id: Schema.optional(Schema.String),
})

const PushTestResult = Schema.Struct({
  sent: Schema.Boolean,
}).annotate({ identifier: "PushTestResult" })

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  pushPublicKey: "/global/push/public-key",
  pushSubscriptions: "/global/push/subscriptions",
  pushSubscription: "/global/push/subscriptions/:id",
  pushTest: "/global/push/test",
  config: "/global/config",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
} as const

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the OpenCode server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the OpenCode system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("pushPublicKey", GlobalPaths.pushPublicKey, {
        success: described(PushPublicKey, "Push configuration"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.pushPublicKey",
          summary: "Get push public key",
          description: "Get the VAPID public key used for Web Push subscriptions.",
        }),
      ),
      HttpApiEndpoint.get("listPushSubscriptions", GlobalPaths.pushSubscriptions, {
        success: described(Schema.Array(PushSubscription), "Push subscriptions"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.listPushSubscriptions",
          summary: "List push subscriptions",
          description: "List registered Web Push subscriptions for the current server.",
        }),
      ),
      HttpApiEndpoint.post("upsertPushSubscription", GlobalPaths.pushSubscriptions, {
        payload: PushSubscriptionUpsert,
        success: described(PushSubscription, "Push subscription"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upsertPushSubscription",
          summary: "Upsert push subscription",
          description: "Create or update a Web Push subscription for the current device.",
        }),
      ),
      HttpApiEndpoint.delete("removePushSubscription", GlobalPaths.pushSubscription, {
        params: { id: Schema.String },
        success: described(Schema.Boolean, "Subscription removed"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.removePushSubscription",
          summary: "Remove push subscription",
          description: "Delete a Web Push subscription by id.",
        }),
      ),
      HttpApiEndpoint.patch("updatePushSubscription", GlobalPaths.pushSubscription, {
        params: { id: Schema.String },
        payload: PushSubscriptionUpdate,
        success: described(PushSubscription, "Push subscription"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.updatePushSubscription",
          summary: "Update push subscription",
          description: "Update editable fields for a Web Push subscription by id.",
        }),
      ),
      HttpApiEndpoint.post("testPush", GlobalPaths.pushTest, {
        payload: PushTestInput,
        success: described(PushTestResult, "Test push result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.testPush",
          summary: "Send test push",
          description: "Send a test Web Push notification to the current or selected device.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(ConfigV1.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: ConfigV1.Info,
        success: described(ConfigV1.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: [HttpApiSchema.NoContent, GlobalUpgradeInput],
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade opencode",
          description: "Upgrade opencode to the specified version or latest if not specified.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
