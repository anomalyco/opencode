export * as WebSearch from "./websearch.js"

import { WebSearch } from "@opencode-ai/schema/websearch"
import type { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { Clock, Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { HttpClientError } from "effect/unstable/http"
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

export interface Interface extends State.Transformable<Editor> {
  readonly providers: () => Effect.Effect<readonly Provider[]>
  readonly default: () => Effect.Effect<Provider | undefined, DisabledError>
  readonly select: (selection: Selection) => Effect.Effect<void>
  readonly query: (
    input: Input,
    options?: {
      readonly sessionID?: Session.ID
      readonly onProvider?: (provider: Provider) => Effect.Effect<void>
    },
  ) => Effect.Effect<Response, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WebSearch") {}

type Data = {
  readonly providers: Map<ID, ProviderImplementation>
  selection?: Selection
}

export type Editor = {
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
    const cooldowns = new Map<ID, { until: number; error: RequestError }>()
    const preferred = new Map<Session.ID | undefined, { provider?: ID }>()
    yield* Effect.addFinalizer(() => Effect.sync(() => preferred.clear()))
    yield* bus.subscribe([SessionEvent.Deleted, SessionEvent.Moved]).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          preferred.delete(event.data.sessionID)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    const state = State.create<Data, Editor>({
      initial: () => ({ providers: new Map() }),
      editor: (editor) => ({
        add: (provider) => editor.providers.set(provider.id, provider),
        default: {
          get: () => editor.selection,
          set: (selection) => (editor.selection = selection),
        },
      }),
      notify: () => bus.publish(WebSearch.Event.Updated, {}).pipe(Effect.asVoid),
    })

    const requireProvider = (providers: Map<ID, ProviderImplementation>, providerID: ID) => {
      const provider = providers.get(providerID)
      return provider ? Effect.succeed(provider) : Effect.fail(new ProviderNotFoundError({ providerID }))
    }

    const selection = Effect.fn("WebSearch.selection")(function* () {
      const data = state.get()
      if (
        data.selection === false ||
        data.selection === "random" ||
        (data.selection && data.providers.has(data.selection))
      )
        return data.selection
      const stored = yield* kv.get(ProviderKey)
      const decoded = Schema.decodeUnknownOption(Selection)(stored)
      if (stored !== undefined && Option.isNone(decoded)) yield* kv.remove(ProviderKey)
      return Option.getOrUndefined(decoded)
    })

    const randomProvider = (now: number, affinity: { provider?: ID }, attempted?: Set<ID>) => {
      const providers = state.get().providers
      cooldowns.forEach((cooldown, id) => {
        if (cooldown.until <= now || !providers.has(id)) cooldowns.delete(id)
      })
      const current = affinity.provider === undefined ? undefined : providers.get(affinity.provider)
      if (current && !cooldowns.has(current.id) && !attempted?.has(current.id)) return current
      const available = Array.from(providers.values()).filter(
        (provider) => !cooldowns.has(provider.id) && !attempted?.has(provider.id),
      )
      const provider = available[Math.floor(Math.random() * available.length)]
      if (provider) affinity.provider = provider.id
      return provider
    }

    const defaultProvider = Effect.fn("WebSearch.default")(function* (choice: Selection | undefined) {
      if (choice === false) return yield* new DisabledError()
      if (choice === "random") {
        // Inspection must not select a provider or reopen consent when every provider is cooling down.
        const active = preferred.get(undefined)?.provider
        return (
          (active === undefined ? undefined : state.get().providers.get(active)) ??
          state.get().providers.values().next().value
        )
      }
      return choice ? state.get().providers.get(choice) : undefined
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
        const provider = yield* defaultProvider(yield* selection())
        return provider && { id: provider.id, name: provider.name }
      }),
      select: Effect.fn("WebSearch.select")(function* (selection) {
        yield* kv.set(ProviderKey, selection)
      }),
      query: Effect.fn("WebSearch.query")(function* (input, options) {
        const choice = input.providerID ? undefined : yield* selection()
        let provider = input.providerID
          ? yield* requireProvider(state.get().providers, input.providerID)
          : yield* defaultProvider(choice)
        if (!provider) return yield* new ProviderRequiredError()
        // Keep the cell for this query so deletion/movement cannot reinsert an in-flight session's entry.
        const affinity = preferred.get(options?.sessionID) ?? { provider: undefined }
        if (choice === "random") {
          preferred.set(options?.sessionID, affinity)
          provider = randomProvider(yield* Clock.currentTimeMillis, affinity) ?? provider
        }
        const attempted = new Set<ID>()
        while (true) {
          if (options?.onProvider) yield* options.onProvider({ id: provider.id, name: provider.name })
          let cooldown = choice === "random" ? cooldowns.get(provider.id) : undefined
          if (!cooldown || cooldown.until <= (yield* Clock.currentTimeMillis)) {
            attempted.add(provider.id)
            const result = yield* provider
              .execute({ query: input.query })
              .pipe(Effect.flatMap(decodeResults), Effect.result)
            if (result._tag === "Success") return new Response({ providerID: provider.id, results: result.success })
            const cause = result.failure
            const error = new RequestError({ providerID: provider.id, cause })
            if (choice !== "random" || !HttpClientError.isHttpClientError(cause) || cause.response?.status !== 429)
              return yield* error
            const now = yield* Clock.currentTimeMillis
            cooldown = { until: now + cooldownMillis(cause.response.headers["retry-after"], now), error }
            cooldowns.set(provider.id, cooldown)
          }
          provider = randomProvider(yield* Clock.currentTimeMillis, affinity, attempted)
          if (!provider) return yield* cooldown.error
        }
      }),
    })
  }),
)

function cooldownMillis(value: string | undefined, now: number) {
  if (!value?.trim()) return 60_000
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : 60_000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : 60_000
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, KV.node],
})
