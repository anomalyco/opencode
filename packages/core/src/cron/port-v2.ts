export * as CronPortV2 from "./port-v2"

import { Effect, Layer } from "effect"
import { CronDeliveryPort, CronDeliveryError } from "./port"
import { SessionInput } from "../session/input"
import { SessionV2 } from "../session"
import { SessionMessage } from "../session/message"
import { Prompt } from "../session/prompt"
import { Database } from "../database/database"
import { EventV2 } from "../event"

export const CronDeliveryPortLive = Layer.effect(
  CronDeliveryPort,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service

    return CronDeliveryPort.of({
      isBusy: () => Effect.succeed(false),
      deliver: (sessionID, prompt, opts) =>
        Effect.gen(function* () {
          yield* SessionInput.admit(db, events, {
            id: SessionMessage.ID.create(),
            sessionID: SessionV2.ID.make(sessionID),
            prompt: Prompt.make({ text: prompt }),
            delivery: "queue",
          })
        }).pipe(Effect.mapError((e) => new CronDeliveryError({ message: String(e) }))),
      exists: () => Effect.succeed(true),
    })
  }),
)
