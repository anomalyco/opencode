export * as WebSearch from "./websearch.js"

import { WebSearch } from "@opencode-ai/schema/websearch"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus.js"
import { KV } from "./kv.js"
import { State } from "./state.js"

export const ID = WebSearch.ID
export type ID = WebSearch.ID

export const Provider = WebSearch.Provider
export type Provider = WebSearch.Provider

export { Event } from "@opencode-ai/schema/websearch"

export const Input = WebSearch.Input
export type Input = WebSearch.Input
export type ProviderInput = WebSearch.ProviderInput

export const Result = WebSearch.Result
export type Result = WebSearch.Result

export const Response = WebSearch.Response
export type Response = WebSearch.Response

export const ProviderKey = "websearch:provider"
export const Selection = Schema.Union([ID, Schema.Literal("random"), Schema.Literal(false)])
export type Selection = typeof Selection.Type

export interface ProviderImplementation extends Provider {
  readonly execute: (input: ProviderInput) => Effect.Effect<readonly Result[], unknown>
}

export class ProviderRequiredError extends Schema.TaggedError<ProviderRequiredError>()(
  "WebSearch.ProviderRequired",
  {},
) {}

export class ProviderNotFoundError extends Schema.TaggedError<ProviderNotFoundError>()("WebSearch.ProviderNotFound", {
  providerID: ID,
}) {}

export class DisabledError extends Schema.TaggedError<DisabledError>()("WebSearch.Disabled", {}) {}

export class RequestError extends Schema.TaggedError<RequestError>()("WebSearch.Request", {
  providerID: ID,
  cause: Schema.Defect(),
}) {}

export type Error = ProviderRequiredError | ProviderNotFoundError | DisabledError | RequestError

export interface Interface extends State.Transformable<Draft> {
  readonly providers: () => Effect.Effect<readonly Provider[]>
  readonly default: () => Effect.Effect<Provider | undefined, DisabledError>
  readonly select: (selection: Selection) => Effect.Effect<void>
  readonly query: (input: Input) => Effect.Effect<Response, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WebSearch") {}

type Data = {
  readonly providers: Map<ID, ProviderImplementation>
  selection?: Selection
}

export type Draft = {
  add: (provider: ProviderImplementation) => void
  default: {
    get: () => Selection | undefined
    set: (selection: Selection) => void
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const kv = yield* KV.Service
    const decodeResults = Schema.decodeUnknownEffect(Schema.Array(Result))
    const state = State.create<Data, Draft>({
      initial: () => ({ providers: new Map() }),
      draft: (draft) => ({
        add: (provider) => draft.providers.set(provider.id, provider),
        default: {
          get: () => draft.selection,
          set: (selection) => (draft.selection = selection),
        },
      }),
      finalize: () => bus.publish(WebSearch.Event.Updated, {}).pipe(Effect.asVoid),
    })

    const requireProvider = (providers: Map<ID, ProviderImplementation>, providerID: ID) => {
      const provider = providers.get(providerID)
      return provider ? Effect.succeed(provider) : Effect.fail(new ProviderNotFoundError({ providerID }))
    }

    const defaultProvider = Effect.fn("WebSearch.default")(function* () {
      const data = state.get()
      const stored = data.selection === undefined ? yield* kv.get(ProviderKey) : undefined
      const decoded = Schema.decodeUnknownOption(Selection)(stored)
      if (stored !== undefined && Option.isNone(decoded)) yield* kv.remove(ProviderKey)
      const selection = data.selection ?? Option.getOrUndefined(decoded)
      if (selection === false) return yield* new DisabledError()
      if (selection === "random") {
        const providers = Array.from(data.providers.values())
        return providers[Math.floor(Math.random() * providers.length)]
      }
      return selection ? data.providers.get(selection) : undefined
    })

    const resolve = Effect.fn("WebSearch.resolve")(function* (input: Input) {
      const providers = state.get().providers
      if (input.providerID) return yield* requireProvider(providers, input.providerID)
      const provider = yield* defaultProvider()
      if (!provider) return yield* new ProviderRequiredError()
      return provider
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      providers: Effect.fn("WebSearch.providers")(function* () {
        return Array.from(state.get().providers.values(), (provider) => ({
          id: provider.id,
          name: provider.name,
        })).toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      default: Effect.fn("WebSearch.defaultInfo")(function* () {
        const provider = yield* defaultProvider()
        return provider && { id: provider.id, name: provider.name }
      }),
      select: Effect.fn("WebSearch.select")(function* (selection) {
        yield* kv.set(ProviderKey, selection)
      }),
      query: Effect.fn("WebSearch.query")(function* (input) {
        const provider = yield* resolve(input)
        const results = yield* provider.execute({ query: input.query }).pipe(
          Effect.flatMap(decodeResults),
          Effect.mapError((cause) => new RequestError({ providerID: provider.id, cause })),
        )
        return new Response({ providerID: provider.id, results })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, KV.node],
})
