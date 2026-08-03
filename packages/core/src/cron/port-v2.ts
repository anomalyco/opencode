export * as CronPortV2 from "./port-v2"

import { Effect, Layer } from "effect"
import { CronDeliveryPort, CronDeliveryError } from "./port"
import { SessionInput } from "../session/input"
import { SessionV2 } from "../session"
import { SessionMessage } from "../session/message"
import { Prompt } from "../session/prompt"
import { SessionExecution } from "../session/execution"
import { Database } from "../database/database"
import { EventV2 } from "../event"

export const CronDeliveryPortLive = Layer.effect(
  CronDeliveryPort,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const execution = yield* SessionExecution.Service
    const sessions = yield* SessionV2.Service

    return CronDeliveryPort.of({
      isBusy: (sessionID, _opts) =>
        Effect.map(execution.active, (active) => active.has(SessionV2.ID.make(sessionID))),
      deliver: (sessionID, prompt, opts) =>
        Effect.gen(function* () {
          yield* SessionInput.admit(db, events, {
            id: SessionMessage.ID.create(),
            sessionID: SessionV2.ID.make(sessionID),
            prompt: Prompt.make({ text: prompt }),
            delivery: "queue",
          })
          yield* execution.wake(SessionV2.ID.make(sessionID))
        }).pipe(Effect.mapError((e) => new CronDeliveryError({ message: String(e) }))),
      exists: (sessionID) =>
        sessions.get(SessionV2.ID.make(sessionID)).pipe(Effect.as(true), Effect.orElseSucceed(() => false)),
    })
  }),
)
