export * as Provider from "./provider.js"

import { Context, Effect, Layer, Schema, Stream, Struct } from "effect"
import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { ProviderPackageDefinition } from "@opencode/ai"
import { isRecord } from "@opencode/ai/utils/record"
import { Npm } from "@opencode/util/npm"
import type { DeepMutable } from "./schema.js"
import { importModule, resolveModule } from "@opencode/util/runtime-import"
import { Bus } from "./bus.js"
import { Integration } from "./integration.js"
import { State } from "./state.js"
import { IntegrationConnection } from "./integration/connection.js"
import { Credential } from "@opencode/schema/credential"
import { Location } from "./location.js"
import { freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK_PREFIX = "aisdk:"
export const isAISDK = (value: string | undefined): value is string => value?.startsWith(AISDK_PREFIX) ?? false
export const aisdk = (value: string) => (isAISDK(value) ? value : `${AISDK_PREFIX}${value}`)
export function packageName(value: string): string
export function packageName(value: undefined): undefined
export function packageName(value: string | undefined): string | undefined
export function packageName(value: string | undefined) {
  // Native provider entrypoints can persist in user configuration across the npm scope migration.
  if (value?.startsWith("@opencode-ai/ai/")) return value.replace("@opencode-ai/", "@opencode/")
  if (value === undefined || !isAISDK(value)) return value
  return value.slice(AISDK_PREFIX.length)
}

type Json = Schema.Schema.Type<typeof Schema.Json>
const JsonRecord = Schema.Record(Schema.String, Schema.Json)
const decodeJsonRecord = Schema.decodeUnknownSync(JsonRecord)

export class LoadError extends Schema.TaggedError<LoadError>()("Provider.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}
export type ProviderPackage = ProviderPackageDefinition

const packages = new Map<string, Promise<unknown>>()
const builtins = new Map<string, () => Promise<unknown>>([
  ["@opencode/ai/providers/amazon-bedrock", () => import("@opencode/ai/providers/amazon-bedrock")],
  ["@opencode/ai/providers/amazon-bedrock/mantle", () => import("@opencode/ai/providers/amazon-bedrock/mantle")],
  [
    "@opencode/ai/providers/amazon-bedrock/mantle/chat",
    () => import("@opencode/ai/providers/amazon-bedrock/mantle/chat"),
  ],
  [
    "@opencode/ai/providers/amazon-bedrock/mantle/responses",
    () => import("@opencode/ai/providers/amazon-bedrock/mantle/responses"),
  ],
  ["@opencode/ai/providers/alibaba/chat", () => import("@opencode/ai/providers/alibaba/chat")],
  ["@opencode/ai/providers/alibaba/messages", () => import("@opencode/ai/providers/alibaba/messages")],
  ["@opencode/ai/providers/alibaba/responses", () => import("@opencode/ai/providers/alibaba/responses")],
  ["@opencode/ai/providers/anthropic", () => import("@opencode/ai/providers/anthropic")],
  ["@opencode/ai/providers/azure", () => import("@opencode/ai/providers/azure")],
  ["@opencode/ai/providers/azure/chat", () => import("@opencode/ai/providers/azure/chat")],
  ["@opencode/ai/providers/azure/responses", () => import("@opencode/ai/providers/azure/responses")],
  ["@opencode/ai/providers/baseten", () => import("@opencode/ai/providers/baseten")],
  ["@opencode/ai/providers/cerebras", () => import("@opencode/ai/providers/cerebras")],
  ["@opencode/ai/providers/cloudflare-ai-gateway", () => import("@opencode/ai/providers/cloudflare-ai-gateway")],
  ["@opencode/ai/providers/cloudflare-workers-ai", () => import("@opencode/ai/providers/cloudflare-workers-ai")],
  ["@opencode/ai/providers/deepinfra", () => import("@opencode/ai/providers/deepinfra")],
  ["@opencode/ai/providers/deepseek", () => import("@opencode/ai/providers/deepseek")],
  ["@opencode/ai/providers/fireworks", () => import("@opencode/ai/providers/fireworks")],
  ["@opencode/ai/providers/google", () => import("@opencode/ai/providers/google")],
  ["@opencode/ai/providers/google-vertex", () => import("@opencode/ai/providers/google-vertex")],
  ["@opencode/ai/providers/google-vertex/gemini", () => import("@opencode/ai/providers/google-vertex/gemini")],
  ["@opencode/ai/providers/google-vertex/chat", () => import("@opencode/ai/providers/google-vertex/chat")],
  ["@opencode/ai/providers/google-vertex/responses", () => import("@opencode/ai/providers/google-vertex/responses")],
  ["@opencode/ai/providers/google-vertex/messages", () => import("@opencode/ai/providers/google-vertex/messages")],
  ["@opencode/ai/providers/groq", () => import("@opencode/ai/providers/groq")],
  ["@opencode/ai/providers/meta/chat", () => import("@opencode/ai/providers/meta/chat")],
  ["@opencode/ai/providers/meta/messages", () => import("@opencode/ai/providers/meta/messages")],
  ["@opencode/ai/providers/meta/responses", () => import("@opencode/ai/providers/meta/responses")],
  ["@opencode/ai/providers/minimax/chat", () => import("@opencode/ai/providers/minimax/chat")],
  ["@opencode/ai/providers/minimax/messages", () => import("@opencode/ai/providers/minimax/messages")],
  ["@opencode/ai/providers/minimax/responses", () => import("@opencode/ai/providers/minimax/responses")],
  ["@opencode/ai/providers/mistral", () => import("@opencode/ai/providers/mistral")],
  ["@opencode/ai/providers/moonshot/chat", () => import("@opencode/ai/providers/moonshot/chat")],
  ["@opencode/ai/providers/moonshot/messages", () => import("@opencode/ai/providers/moonshot/messages")],
  ["@opencode/ai/providers/moonshot/responses", () => import("@opencode/ai/providers/moonshot/responses")],
  ["@opencode/ai/providers/openai", () => import("@opencode/ai/providers/openai")],
  ["@opencode/ai/providers/openai/chat", () => import("@opencode/ai/providers/openai/chat")],
  ["@opencode/ai/providers/openai/responses", () => import("@opencode/ai/providers/openai/responses")],
  ["@opencode/ai/providers/openai-compatible", () => import("@opencode/ai/providers/openai-compatible")],
  ["@opencode/ai/providers/openrouter", () => import("@opencode/ai/providers/openrouter")],
  ["@opencode/ai/providers/togetherai", () => import("@opencode/ai/providers/togetherai")],
  ["@opencode/ai/providers/xai", () => import("@opencode/ai/providers/xai")],
  ["@opencode/ai/providers/zai/chat", () => import("@opencode/ai/providers/zai/chat")],
  ["@opencode/ai/providers/zai-coding-plan/chat", () => import("@opencode/ai/providers/zai-coding-plan/chat")],
  ["@opencode/ai/providers/zai-coding-plan/messages", () => import("@opencode/ai/providers/zai-coding-plan/messages")],
  [
    "@opencode/ai/providers/zai-coding-plan/responses",
    () => import("@opencode/ai/providers/zai-coding-plan/responses"),
  ],
])

export const loadPackage = Effect.fn("Provider.loadPackage")(function* (input: string, npm?: Npm.Interface) {
  const specifier = packageName(input)
  const builtin = builtins.get(specifier)
  if (builtin) return yield* importPackage(specifier, specifier, builtin)
  const resolved = yield* Effect.sync(() => {
    if (specifier.startsWith("file://") || specifier.startsWith("@opencode/ai/")) return specifier
    try {
      return import.meta.resolve(specifier)
    } catch {
      return undefined
    }
  })
  if (resolved) return yield* importPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const parts = specifier.split("/")
  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () => resolveModule(specifier, installed.directory),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importPackage(specifier, entrypoint)
})

/** opencode settings consumed in Core; native packages never receive them. */
const CORE_KEYS = ["chunkTimeout", "compaction", "fetch", "timeout", "transport"] as const
const PROVIDER_ONLY_KEYS = ["chunkTimeout", "timeout", "transport"] as const

export function nativeSettings(settings: Settings): Settings {
  return Struct.omit(settings, CORE_KEYS)
}

export function modelSettings(settings: Settings | undefined) {
  return settings && Struct.omit(settings, PROVIDER_ONLY_KEYS)
}

export function mergeOverlay(
  base: Readonly<Record<string, unknown>> | undefined,
  overlay: Readonly<Record<string, unknown>> | undefined,
): Record<string, Json> | undefined {
  if (base === undefined) return overlay && decodeJsonRecord({ ...overlay })
  if (overlay === undefined) return decodeJsonRecord({ ...base })
  return decodeJsonRecord(
    Object.fromEntries(
      new Set([...Object.keys(base), ...Object.keys(overlay)]).values().map((key): [string, unknown] => {
        const left = base[key]
        const right = overlay[key]
        if (right === undefined) return [key, left]
        if (isRecord(left) && isRecord(right)) return [key, mergeOverlay(left, right) ?? {}]
        return [key, right]
      }),
    ),
  )
}

export function mergeHeaders(
  base: Readonly<Record<string, string>> | undefined,
  overlay: Readonly<Record<string, string>> | undefined,
) {
  if (base === undefined) return overlay && { ...overlay }
  if (overlay === undefined) return { ...base }
  return Object.fromEntries(
    [...Object.entries(base), ...Object.entries(overlay)]
      .reduce((result, entry) => {
        result.set(entry[0].toLowerCase(), entry)
        return result
      }, new Map<string, [string, string]>())
      .values(),
  )
}

export const Request = Provider.Request
export type Request = Provider.Request

export const Compaction = Provider.Compaction
export type Compaction = Provider.Compaction

export const Transport = Provider.Transport
export type Transport = Provider.Transport

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

export { Event } from "@opencode/schema/provider"

/** Provider metadata owns its drafts; model definitions remain immutable inputs. */
export type Definition = {
  readonly provider: Info
  readonly models: ReadonlyMap<Model.ID, Model.Info>
  readonly sourceConnection?: IntegrationConnection.Info
}

export interface Editor {
  readonly list: () => readonly Definition[]
  readonly get: (providerID: ID) => Definition | undefined
  readonly add: (definition: {
    readonly info: Info
    readonly models: readonly Model.Info[]
    readonly sourceConnection?: IntegrationConnection.Info
  }) => void
  readonly update: (providerID: ID, update: (provider: MutableInfo) => void) => void
  readonly remove: (providerID: ID) => void
  readonly models: {
    readonly set: (providerID: ID, models: readonly Model.Info[]) => void
    readonly update: (providerID: ID, modelID: Model.ID, update: (model: DeepMutable<Model.Info>) => void) => void
    readonly remove: (providerID: ID, modelID: Model.ID) => void
  }
}

export interface Snapshot {
  readonly records: ReadonlyMap<ID, Definition>
  readonly available: readonly Definition[]
  readonly providers: readonly Info[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<readonly Info[]>
  readonly available: () => Effect.Effect<readonly Info[]>
  /** Internal definition/access snapshot; raw model inventories never cross the HTTP API. */
  readonly snapshot: () => Effect.Effect<Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Provider") {}

// Every location references the same index for a shared immutable definition array.
const definitions = new WeakMap<readonly Model.Info[], Map<ID, ReadonlyMap<Model.ID, Model.Info>>>()
function index(providerID: ID, models: readonly Model.Info[]) {
  const indexes = definitions.get(models) ?? new Map<ID, ReadonlyMap<Model.ID, Model.Info>>()
  const cached = indexes.get(providerID)
  if (cached) return cached
  // Model shares these definitions without copying, so a foreign definition takes this provider's identity here.
  const result = freeze(
    new Map(models.map((model) => [model.id, model.providerID === providerID ? model : { ...model, providerID }])),
    true,
  )
  indexes.set(providerID, result)
  definitions.set(models, indexes)
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service
    const location = yield* Location.Service
    const state = State.create<
      Map<
        ID,
        {
          provider: MutableInfo
          models: ReadonlyMap<Model.ID, Model.Info>
          sourceConnection?: IntegrationConnection.Info
        }
      >,
      Editor
    >({
      name: "provider",
      initial: () => new Map(),
      editor: (records) => {
        const maps = new WeakSet<ReadonlyMap<Model.ID, Model.Info>>()
        const models = new WeakSet<Model.Info>()
        const entry = (id: ID) => {
          const current = records.get(id)
          if (current) return current
          const added = { provider: Info.empty(id) as MutableInfo, models: new Map<Model.ID, Model.Info>() }
          records.set(id, added)
          maps.add(added.models)
          return added
        }
        const writable = (id: ID) => {
          const record = entry(id)
          if (maps.has(record.models)) return record.models as Map<Model.ID, Model.Info>
          const owned = new Map(record.models)
          record.models = owned
          maps.add(owned)
          return owned
        }
        return {
          list: () => Array.from(records.values()),
          get: (id) => records.get(id),
          add: (definition) => {
            records.set(definition.info.id, {
              provider: structuredClone(definition.info) as MutableInfo,
              models: index(definition.info.id, definition.models),
              sourceConnection: definition.sourceConnection,
            })
          },
          update: (id, update) => {
            const record = entry(id)
            update(record.provider)
            record.provider.id = id
            AISDKNative.rewrite(record.provider, {
              specifier: record.provider.package,
              providerID: id,
              canonical: record.provider.canonical,
            })
          },
          remove: (id) => {
            records.delete(id)
          },
          models: {
            set: (id, values) => {
              entry(id).models = index(id, values)
            },
            update: (providerID, modelID, update) => {
              const record = entry(providerID)
              const target = writable(providerID)
              const current = target.get(modelID)
              const model = // An earlier add/set can publish and freeze an owned model within this fold.
                (
                  current && models.has(current) && !Object.isFrozen(current)
                    ? current
                    : current
                      ? structuredClone(current)
                      : Model.Info.default(providerID, modelID)
                ) as DeepMutable<Model.Info>
              update(model)
              model.id = modelID
              model.providerID = providerID
              AISDKNative.rewrite(model, {
                specifier: model.package ?? record.provider.package,
                providerID,
                canonical: model.canonical ?? record.provider.canonical,
                modelID: model.modelID ?? modelID,
              })
              models.add(model)
              target.set(modelID, model)
            },
            remove: (providerID, modelID) => {
              if (!records.has(providerID)) return
              writable(providerID).delete(modelID)
            },
          },
        }
      },
      notify: () => notify,
    })
    // Registrations may outlive a borrowed service layer; their later disposal must
    // not query dependencies that have already closed.
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    let cached: { records: Snapshot["records"]; value: Snapshot } | undefined
    const snapshot = Effect.fn("Provider.snapshot")(function* () {
      while (true) {
        const revision = integrations.revision()
        const records = state.get()
        // Connection presence decides availability; resolving OAuth tokens belongs to execution.
        const connections = yield* integrations.list()
        // Either fold can disable a plugin that also contributed to the other domain.
        if (revision !== integrations.revision() || records !== state.get()) continue
        const byID = new Map(connections.map((integration) => [integration.id, integration]))
        const available = Array.from(records.values()).filter((record) => {
          if (record.provider.activation === "disabled") return false
          const integration = byID.get(record.provider.integrationID ?? Integration.ID.make(record.provider.id))
          // Never combine the previous account's discovered endpoints/models with a new connection.
          if (
            record.sourceConnection &&
            IntegrationConnection.key(record.sourceConnection) !==
              IntegrationConnection.key(integration?.connections[0])
          )
            return false
          if (record.provider.activation === "enabled") return true
          if (integration?.connections.length) return true
          return record.provider.integrationID === undefined && !integration
        })
        // A credential change that leaves the same definitions available is not a catalog change.
        if (
          cached?.records === records &&
          cached.value.available.length === available.length &&
          cached.value.available.every((record, index) => record === available[index])
        )
          return cached.value
        const value = freeze({ records, available, providers: available.map((record) => record.provider) }, true)
        cached = { records, value }
        return value
      }
    })
    let published: Snapshot | undefined
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* snapshot()
      if (value === published) return
      published = value
      yield* bus.publish(
        Provider.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe([Integration.Event.Updated, Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Provider.get")((id) => Effect.sync(() => freeze(state.get().get(id)?.provider, true))),
      all: Effect.fn("Provider.all")(() =>
        Effect.sync(() => Array.from(state.get().values(), (record) => freeze(record.provider, true))),
      ),
      available: Effect.fn("Provider.available")(() => snapshot().pipe(Effect.map((value) => value.providers))),
      snapshot,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Integration.node, Location.node] })

const importPackage = Effect.fn("Provider.importPackage")(function* (
  specifier: string,
  entrypoint: string,
  load = () => importModule(entrypoint),
) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = packages.get(entrypoint)
      if (existing) return existing
      const loaded = load()
      packages.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (typeof module !== "object" || module === null || typeof (module as { model?: unknown }).model !== "function") {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(modelID, settings)`),
    })
  }
  return module as ProviderPackageDefinition
})
