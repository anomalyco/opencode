export * as OpenCode from "./opencode"

import { Context, Effect, Layer } from "effect"
import { Catalog } from "../catalog"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { LocationServiceMap } from "../location-layer"
import { PluginBoot } from "../plugin/boot"
import { ProjectV2 } from "../project"
import { SessionV2 } from "../session"
import * as SessionExecutionLocal from "../session/execution/local"
import { SessionProjector } from "../session/projector"
import { SessionStore } from "../session/store"
import { ApplicationTools } from "../tool/application-tools"
import { Session } from "./session"
import { Tool } from "./tool"

export interface Interface {
  readonly sessions: Session.Interface
  readonly tools: Tool.Interface
}

/** Intentional public native API for Effect applications embedding OpenCode. */
export class Service extends Context.Service<Service, Interface>()("@opencode/public/OpenCode") {}

class SessionModelValidation extends Context.Service<
  SessionModelValidation,
  {
    readonly validate: (
      input: Session.SwitchModelInput & { readonly location: Session.Info["location"] },
    ) => Effect.Effect<void, Session.ModelUnavailableError | Session.VariantUnavailableError>
  }
>()("@opencode/public/OpenCode/SessionModelValidation") {}

const ApplicationToolsLayer = ApplicationTools.layer
const LocationServicesLayer = LocationServiceMap.layer.pipe(Layer.provide(ApplicationToolsLayer))
const SessionModelValidationLayer = Layer.effect(
  SessionModelValidation,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return SessionModelValidation.of({
      validate: Effect.fn("OpenCode.sessions.validateModel")(function* (input) {
        yield* Effect.gen(function* () {
          yield* (yield* PluginBoot.Service).wait()
          const catalog = yield* Catalog.Service
          const model = (yield* catalog.model.available()).find(
            (model) => model.providerID === input.model.providerID && model.id === input.model.id,
          )
          if (!model)
            return yield* new Session.ModelUnavailableError({
              providerID: input.model.providerID,
              modelID: input.model.id,
            })
          if (
            input.model.variant !== undefined &&
            input.model.variant !== "default" &&
            !model.variants.some((variant) => variant.id === input.model.variant)
          )
            return yield* new Session.VariantUnavailableError({
              providerID: input.model.providerID,
              modelID: input.model.id,
              variant: input.model.variant,
            })
        }).pipe(Effect.provide(locations.get(input.location)))
      }),
    })
  }),
)

const SessionsLayer = Layer.merge(
  SessionV2.layer.pipe(
    Layer.provide(SessionProjector.layer),
    Layer.provide(SessionExecutionLocal.layer),
    Layer.provide(SessionStore.layer),
    Layer.provide(EventV2.layer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(ProjectV2.defaultLayer),
    Layer.orDie,
  ),
  SessionModelValidationLayer,
).pipe(Layer.provide(LocationServicesLayer))
// TODO: Accept explicit storage so tests and embeddings can select disposable or application-owned persistence.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const tools = yield* ApplicationTools.Service
    const validation = yield* SessionModelValidation
    return Service.of({
      tools: { register: tools.register },
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
        switchModel: Effect.fn("OpenCode.sessions.switchModel")(function* (input) {
          const session = yield* sessions.get(input.sessionID)
          yield* validation.validate({ ...input, location: session.location })
          yield* sessions.switchModel(input)
        }),
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
