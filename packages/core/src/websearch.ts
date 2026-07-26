export * as WebSearch from "./websearch"

import { WebSearch } from "@opencode-ai/schema/websearch"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { Context, Effect, Layer, Schema, Scope, Semaphore, Stream } from "effect"
import path from "node:path"
import { Config } from "./config"
import { ConfigGlobal } from "./config/global"
import { ConfigWebSearch } from "./config/websearch"
import { makeLocationNode } from "./effect/app-node"
import { EventV2 } from "./event"
import { Form } from "./form"
import { Global } from "./global"
import { State } from "./state"

export const ID = WebSearch.ID
export type ID = WebSearch.ID

export const Provider = WebSearch.Provider
export type Provider = WebSearch.Provider

export const Event = WebSearch.Event

export const Input = WebSearch.Input
export type Input = WebSearch.Input
export type ProviderInput = WebSearch.ProviderInput

export const ProviderOutput = WebSearch.ProviderOutput
export type ProviderOutput = WebSearch.ProviderOutput

export const Result = WebSearch.Result
export type Result = WebSearch.Result

export interface ProviderImplementation extends Provider {
  readonly execute: (
    input: ProviderInput,
    context: { readonly sessionID?: string },
  ) => Effect.Effect<ProviderOutput, unknown>
}

export class ProviderRequiredError extends Schema.TaggedErrorClass<ProviderRequiredError>()(
  "WebSearch.ProviderRequired",
  {},
) {}

export class ProviderNotFoundError extends Schema.TaggedErrorClass<ProviderNotFoundError>()(
  "WebSearch.ProviderNotFound",
  {
    providerID: ID,
  },
) {}

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("WebSearch.Cancelled", {}) {}

export class RequestError extends Schema.TaggedErrorClass<RequestError>()("WebSearch.Request", {
  providerID: ID,
  cause: Schema.Defect(),
}) {}

export type Error = ProviderRequiredError | ProviderNotFoundError | CancelledError | RequestError

export interface QueryInput extends Input {
  readonly sessionID?: string
}

export interface Interface {
  readonly register: (provider: ProviderImplementation) => Effect.Effect<State.Registration, never, Scope.Scope>
  readonly list: () => Effect.Effect<readonly Provider[]>
  readonly selected: () => Effect.Effect<ID | undefined>
  readonly select: (providerID: ID) => Effect.Effect<void, ProviderNotFoundError>
  readonly query: (input: QueryInput) => Effect.Effect<Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/WebSearch") {}

type Data = {
  readonly providers: Map<ID, ProviderImplementation>
}

type Draft = {
  register: (provider: ProviderImplementation) => void
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const configGlobal = yield* ConfigGlobal.Service
    const events = yield* EventV2.Service
    const forms = yield* Form.Service
    const global = yield* Global.Service
    const onboarding = Semaphore.makeUnsafe(1)
    const decodeOutput = Schema.decodeUnknownEffect(ProviderOutput)
    const globalConfigPath = path.resolve(global.config)
    let pendingProviderID: ID | undefined
    const state = State.create<Data, Draft>({
      initial: () => ({ providers: new Map() }),
      draft: (draft) => ({
        register: (provider) => draft.providers.set(provider.id, provider),
      }),
      finalize: () => events.publish(Event.Updated, {}).pipe(Effect.asVoid),
    })

    const requireProvider = (providers: Map<ID, ProviderImplementation>, providerID: ID) => {
      const provider = providers.get(providerID)
      return provider ? Effect.succeed(provider) : Effect.fail(new ProviderNotFoundError({ providerID }))
    }

    const globalProviderID = Effect.fn("WebSearch.globalProviderID")(function* () {
      return Config.latest(
        (yield* config.entries()).filter(
          (entry) => entry.type === "document" && entry.path && path.dirname(entry.path) === globalConfigPath,
        ),
        "websearch",
      )?.provider
    })

    const selected = Effect.fn("WebSearch.selected")(function* () {
      return pendingProviderID ?? (yield* globalProviderID())
    })

    const saveProvider = Effect.fn("WebSearch.saveProvider")(function* (providerID: ID) {
      pendingProviderID = providerID
      yield* configGlobal.update(["websearch"], new ConfigWebSearch.Info({ provider: providerID })).pipe(
        Effect.tapError(() => Effect.sync(() => (pendingProviderID = undefined))),
        Effect.orDie,
      )
    })

    yield* events.subscribe(ConfigSchema.Event.Updated).pipe(
      Stream.runForEach(() =>
        globalProviderID().pipe(
          Effect.tap((providerID) =>
            Effect.sync(() => {
              if (providerID === pendingProviderID) pendingProviderID = undefined
            }),
          ),
          Effect.ignore,
        ),
      ),
      Effect.forkScoped,
    )

    const ask = Effect.fn("WebSearch.ask")(function* (providers: Map<ID, ProviderImplementation>, sessionID: string) {
      if (providers.size === 0) return yield* new ProviderRequiredError()
      const response = yield* forms
        .ask({
          sessionID,
          title: "Choose a web search provider",
          metadata: { kind: "websearch.provider" },
          fields: [
            {
              key: "provider",
              title: "Provider",
              description: "This becomes your default and can be changed later from Connect.",
              type: "string",
              required: true,
              custom: false,
              options: Array.from(providers.values())
                .toSorted((a, b) => a.name.localeCompare(b.name))
                .map((provider) => ({
                  value: provider.id,
                  label: provider.name,
                })),
            },
          ],
        })
        .pipe(Effect.orDie)
      if (response.status === "cancelled") return yield* new CancelledError()
      const answer = response.answer.provider
      if (typeof answer !== "string") return yield* new ProviderRequiredError()
      return yield* requireProvider(providers, ID.make(answer))
    })

    const resolve = Effect.fn("WebSearch.resolve")(function* (input: QueryInput) {
      const providers = state.get().providers
      if (input.providerID) return yield* requireProvider(providers, input.providerID)
      const configuredProviderID = Config.latest(yield* config.entries(), "websearch")?.provider
      if (configuredProviderID) return yield* requireProvider(providers, configuredProviderID)
      if (process.env.OPENCODE_WEBSEARCH_PROVIDER) {
        return yield* requireProvider(providers, ID.make(process.env.OPENCODE_WEBSEARCH_PROVIDER))
      }
      if (truthy("OPENCODE_ENABLE_PARALLEL") || truthy("OPENCODE_EXPERIMENTAL_PARALLEL")) {
        return yield* requireProvider(providers, ID.make("parallel"))
      }
      if (truthy("OPENCODE_EXPERIMENTAL") || truthy("OPENCODE_ENABLE_EXA") || truthy("OPENCODE_EXPERIMENTAL_EXA")) {
        return yield* requireProvider(providers, ID.make("exa"))
      }
      const providerID = yield* selected()
      const provider = providerID ? providers.get(providerID) : undefined
      if (provider) return provider
      const sessionID = input.sessionID
      if (!sessionID) return yield* new ProviderRequiredError()
      return yield* onboarding.withPermit(
        Effect.gen(function* () {
          const current = yield* selected()
          const selectedProvider = current ? providers.get(current) : undefined
          if (selectedProvider) return selectedProvider
          const provider = yield* ask(providers, sessionID)
          yield* saveProvider(provider.id)
          return provider
        }),
      )
    })

    return Service.of({
      register: (provider) => state.transform((draft) => draft.register(provider)),
      list: Effect.fn("WebSearch.list")(function* () {
        return Array.from(state.get().providers.values(), (provider) => ({
          id: provider.id,
          name: provider.name,
        })).toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      selected,
      select: Effect.fn("WebSearch.select")(function* (providerID) {
        if (!state.get().providers.has(providerID)) return yield* new ProviderNotFoundError({ providerID })
        yield* saveProvider(providerID)
      }),
      query: Effect.fn("WebSearch.query")(function* (input) {
        const provider = yield* resolve(input)
        const output = yield* provider.execute({ query: input.query }, { sessionID: input.sessionID }).pipe(
          Effect.flatMap(decodeOutput),
          Effect.mapError((cause) => new RequestError({ providerID: provider.id, cause })),
        )
        return new Result({ providerID: provider.id, ...output })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, ConfigGlobal.node, EventV2.node, Form.node, Global.node],
})

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}
