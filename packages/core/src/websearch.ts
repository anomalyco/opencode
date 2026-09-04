export * as WebSearch from "./websearch.js"

import { WebSearch } from "@opencode-ai/schema/websearch"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
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
export const Selection = Schema.Union([
  ID,
  Schema.Literal("auto"),
  Schema.Literal("random").annotate({ description: 'Deprecated alias for "auto".', deprecated: true }),
  Schema.Literal(false),
])
export type Selection = typeof Selection.Type

export function normalizeSelection(selection: string | false): Exclude<Selection, "random"> {
  if (selection === false || selection === "auto") return selection
  if (selection === "random") return "auto"
  return ID.make(selection)
}

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
    options?: { readonly onProvider?: (provider: Provider) => Effect.Effect<void> },
  ) => Effect.Effect<Response, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WebSearch") {}

type Data = {
  readonly providers: Map<ID, ProviderImplementation>
  selection?: Exclude<Selection, "random">
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
    let active: ID | undefined
    const state = State.create<Data, Editor>({
      initial: () => ({ providers: new Map() }),
      editor: (editor) => ({
        add: (provider) => editor.providers.set(provider.id, provider),
        default: {
          get: () => editor.selection,
          set: (selection) => (editor.selection = normalizeSelection(selection)),
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
      const configured =
        data.selection === false || data.selection === "auto" || (data.selection && data.providers.has(data.selection))
          ? data.selection
          : undefined
      const stored = configured === undefined ? yield* kv.get(ProviderKey) : undefined
      const decoded = Schema.decodeUnknownOption(Selection)(stored)
      if (stored !== undefined && Option.isNone(decoded)) yield* kv.remove(ProviderKey)
      const selection = configured ?? Option.getOrUndefined(decoded)
      return selection === undefined ? undefined : normalizeSelection(selection)
    })

    const autoProvider = (now: number, attempted?: Set<ID>) => {
      const providers = state.get().providers
      cooldowns.forEach((cooldown, id) => {
        if (cooldown.until <= now || !providers.has(id)) cooldowns.delete(id)
      })
      const available = Array.from(providers.values()).filter(
        (provider) => !cooldowns.has(provider.id) && !attempted?.has(provider.id),
      )
      const provider =
        available.find((provider) => provider.id === active) ?? available[Math.floor(Math.random() * available.length)]
      active = provider?.id
      return provider
    }

    const defaultProvider = Effect.fn("WebSearch.default")(function* (
      choice: Exclude<Selection, "random"> | undefined,
    ) {
      if (choice === false) return yield* new DisabledError()
      if (choice === "auto") {
        // A configured but cooling-down provider must not trigger the consent form again.
        return autoProvider(yield* Clock.currentTimeMillis) ?? state.get().providers.values().next().value
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
        yield* kv.set(ProviderKey, normalizeSelection(selection))
      }),
      query: Effect.fn("WebSearch.query")(function* (input, options) {
        const choice = input.providerID ? undefined : yield* selection()
        const provider = input.providerID
          ? yield* requireProvider(state.get().providers, input.providerID)
          : yield* defaultProvider(choice)
        if (!provider) return yield* new ProviderRequiredError()
        const attempted = new Set<ID>()
        const attempt = (provider: ProviderImplementation): Effect.Effect<Response, RequestError> =>
          Effect.gen(function* () {
            if (options?.onProvider) yield* options.onProvider({ id: provider.id, name: provider.name })
            if (choice === "auto") {
              const cooldown = cooldowns.get(provider.id)
              const now = yield* Clock.currentTimeMillis
              if (cooldown && cooldown.until > now) {
                const next = autoProvider(now, attempted)
                if (!next) return yield* cooldown.error
                return yield* attempt(next)
              }
            }
            attempted.add(provider.id)
            return yield* provider.execute({ query: input.query }).pipe(
              Effect.flatMap(decodeResults),
              Effect.map((results) => new Response({ providerID: provider.id, results })),
              Effect.catch((cause) =>
                Effect.gen(function* () {
                  const error = new RequestError({ providerID: provider.id, cause })
                  if (choice !== "auto" || !HttpClientError.isHttpClientError(cause) || cause.response?.status !== 429)
                    return yield* error
                  const now = yield* Clock.currentTimeMillis
                  cooldowns.set(provider.id, {
                    until: now + cooldownMillis(cause.response.headers["retry-after"], now),
                    error,
                  })
                  const next = autoProvider(now, attempted)
                  if (!next) return yield* error
                  return yield* attempt(next)
                }),
              ),
            )
          })
        return yield* attempt(provider)
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
