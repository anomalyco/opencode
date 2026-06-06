export * as OpenCode from "./opencode"

import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { LocationServiceMap } from "../location-layer"
import { SessionV2 } from "../session"
import * as SessionExecutionLocal from "../session/execution/local"
import { ApplicationTools } from "../tool/application-tools"
import { Session } from "./session"
import { Tool } from "./tool"

export interface Interface {
  readonly sessions: Session.Interface
  readonly tools: Tool.Service
}

/** Intentional public native API for Effect applications embedding OpenCode. */
export class Service extends Context.Service<Service, Interface>()("@opencode/public/OpenCode") {}

const SessionsLayer = SessionV2.defaultLayer.pipe(
  Layer.provide(SessionExecutionLocal.defaultLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(Database.defaultLayer),
)
const ApplicationToolsLayer = ApplicationTools.layer

// TODO: Accept explicit storage so tests and embeddings can select disposable or application-owned persistence.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const tools = yield* ApplicationTools.Service
    return Service.of({
      tools: { attach: tools.attach },
      sessions: {
        create: (input) =>
          sessions.create({
            id: input.id,
            agent: input.agent,
            model: input.model,
            location: input.location,
          }),
        get: sessions.get,
        list: sessions.list,
        interrupt: sessions.interrupt,
        prompt: (input) =>
          sessions.prompt({
            id: input.id,
            sessionID: input.sessionID,
            prompt: input.prompt,
            delivery: input.delivery,
          }),
        messages: (input) =>
          sessions.messages({
            sessionID: input.sessionID,
            limit: input.limit,
            order: input.order,
            cursor: input.cursor,
          }),
        message: (input) => sessions.message({ sessionID: input.sessionID, messageID: input.messageID }),
        context: sessions.context,
        events: (input) => sessions.events({ sessionID: input.sessionID, after: input.after }),
      },
    })
  }),
).pipe(Layer.provide(Layer.merge(ApplicationToolsLayer, SessionsLayer)))

// TODO: Add OpenCode.create(...) as the Promise facade over the same native API semantics.
