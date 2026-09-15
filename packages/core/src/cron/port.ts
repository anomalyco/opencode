export * as CronPort from "./port"

import { Context, Effect, Schema } from "effect"

export class CronDeliveryError extends Schema.TaggedErrorClass<CronDeliveryError>()("Cron.DeliveryError", {
  message: Schema.String,
}) {}

export class CronError extends Schema.TaggedErrorClass<CronError>()("Cron.Error", {
  message: Schema.String,
}) {}

interface Interface {
  readonly deliver: (
    sessionID: string,
    prompt: string,
    opts?: { readonly agent?: string; readonly model?: string; readonly context?: unknown },
  ) => Effect.Effect<void, CronDeliveryError>
  readonly exists: (sessionID: string) => Effect.Effect<boolean>
}

export class CronDeliveryPort extends Context.Service<CronDeliveryPort, Interface>()("@opencode/CronDeliveryPort") {}
