import { Model } from "@opencode/schema/model"
import { Provider } from "./provider.js"
import type { DeepMutable } from "./schema.js"
import { Context, Effect, Layer, Stream } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "./bus.js"
import { State } from "./state.js"
import { Location } from "./location.js"
import { freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"

export const ID = Model.ID
export type ID = typeof ID.Type

export const VariantID = Model.VariantID
export type VariantID = typeof VariantID.Type

// Grouping of models, eg claude opus, claude sonnet
export const Family = Model.Family
export type Family = Model.Family

export const ReasoningField = Model.ReasoningField
export type ReasoningField = Model.ReasoningField

export const Compatibility = Model.Compatibility
export type Compatibility = Model.Compatibility

export const Capabilities = Model.Capabilities
export type Capabilities = Model.Capabilities

export const Cost = Model.Cost

export const Ref = Model.Ref
export type Ref = typeof Ref.Type

export const Info = Model.Info
export type Info = Model.Info

export type MutableInfo = DeepMutable<Info>

export { Event } from "@opencode/schema/model"

export interface Editor {
  /** Includes disabled candidates so later transforms can re-enable them. */
  readonly list: (providerID?: Provider.ID) => readonly MutableInfo[]
  readonly get: (providerID: Provider.ID, modelID: ID) => MutableInfo | undefined
  readonly update: (providerID: Provider.ID, modelID: ID, update: (model: MutableInfo) => void) => void
  readonly remove: (providerID: Provider.ID, modelID: ID) => void
  readonly default: {
    readonly get: () => { providerID: Provider.ID; modelID: ID } | undefined
    readonly set: (providerID: Provider.ID, modelID: ID) => void
  }
  /** Coherent, read-only provider inputs, including definitions from inactive providers. */
  readonly provider: {
    readonly list: () => readonly Provider.Definition[]
    readonly get: (providerID: Provider.ID) => Provider.Definition | undefined
  }
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: Provider.ID, modelID: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<readonly Info[]>
  readonly available: () => Effect.Effect<readonly Info[]>
  readonly default: () => Effect.Effect<Info | undefined>
  readonly small: (providerID: Provider.ID) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Model") {}

type Data = {
  models: Map<Provider.ID, Map<ID, MutableInfo>>
  defaultModel?: { providerID: Provider.ID; modelID: ID }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    let input: Provider.Snapshot | undefined
    const state: State.Interface<Data, Editor> = State.create<Data, Editor>({
      name: "model",
      initial: () => ({
        models: new Map(
          (input?.available ?? []).map((record) => [
            record.provider.id,
            new Map(
              Array.from(record.models, ([id, model]) => [
                id,
                {
                  ...structuredClone(model),
                  id,
                  providerID: record.provider.id,
                } as MutableInfo,
              ]),
            ),
          ]),
        ),
      }),
      editor: (data) => ({
        list: (providerID) =>
          providerID === undefined
            ? Array.from(data.models.values()).flatMap((models) => Array.from(models.values()))
            : Array.from(data.models.get(providerID)?.values() ?? []),
        get: (providerID, modelID) => data.models.get(providerID)?.get(modelID),
        update: (providerID, modelID, update) => {
          // Model edits cannot create/enable a provider or bypass its availability decision.
          const models = data.models.get(providerID)
          if (!models) return
          const model = models.get(modelID) ?? (Info.default(providerID, modelID) as MutableInfo)
          update(model)
          model.id = modelID
          model.providerID = providerID
          const provider = input?.records.get(providerID)?.provider
          AISDKNative.rewrite(model, {
            specifier: model.package ?? provider?.package,
            providerID,
            canonical: model.canonical ?? provider?.canonical,
            modelID: model.modelID ?? modelID,
          })
          models.set(modelID, model)
        },
        remove: (providerID, modelID) => {
          data.models.get(providerID)?.delete(modelID)
        },
        default: {
          get: () => data.defaultModel,
          set: (providerID, modelID) => {
            data.defaultModel = { providerID, modelID }
          },
        },
        provider: {
          list: () => Array.from(input?.records.values() ?? []),
          get: (providerID) => input?.records.get(providerID),
        },
      }),
      // read() also refreshes dependencies changed inside a State.batch before notification.
      notify: () => notify,
    })
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    let cached:
      | {
          data: Data
          all: readonly Info[]
          available: readonly Info[]
          byProvider: ReadonlyMap<Provider.ID, ReadonlyMap<ID, Info>>
        }
      | undefined
    const read = Effect.fn("Model.snapshot")(function* () {
      while (true) {
        const current = yield* providers.snapshot()
        if (input !== current) {
          input = current
          state.invalidate()
        }
        const data = state.get()
        if (cached?.data === data) return cached
        // A failed model transform can remove its plugin's provider/integration registrations.
        // Re-materialize from the surviving inputs, not from the failed candidate's seed.
        if (current !== (yield* providers.snapshot())) continue
        const byProvider = new Map(
          Array.from(data.models, ([providerID, models]) => {
            const provider = current.records.get(providerID)?.provider
            return [
              providerID,
              new Map(
                Array.from(models, ([id, model]) => [
                  id,
                  {
                    ...model,
                    ...(provider?.canonical === undefined ? {} : { canonical: provider.canonical }),
                    package: model.package ?? provider?.package,
                    compaction: model.compaction ?? provider?.compaction,
                    transport: model.transport ?? provider?.transport,
                    settings: Provider.mergeOverlay(provider?.settings, model.settings),
                    headers: Provider.mergeHeaders(provider?.headers, model.headers),
                    body: Provider.mergeOverlay(provider?.body, model.body),
                  } satisfies Info,
                ]),
              ),
            ]
          }),
        )
        const all = Array.from(byProvider.values())
          .flatMap((models) => Array.from(models.values()))
          .sort((left, right) => right.time.released - left.time.released)
        cached = freeze({ data, all, available: all.filter((model) => model.enabled), byProvider }, true)
        return cached
      }
    })
    const prepare = providers.snapshot().pipe(
      Effect.tap((current) =>
        Effect.sync(() => {
          if (input === current) return
          input = current
          state.invalidate()
        }),
      ),
    )
    const reload = () => prepare.pipe(Effect.andThen(state.reload()))
    let published: typeof cached
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* read()
      if (value === published) return
      published = value
      yield* bus.publish(
        Model.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe(Provider.Event.Updated).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: (update) => prepare.pipe(Effect.andThen(state.transform(update))),
      reload,
      get: Effect.fn("Model.get")((providerID, modelID) =>
        read().pipe(Effect.map((value) => value.byProvider.get(providerID)?.get(modelID))),
      ),
      all: Effect.fn("Model.all")(() => read().pipe(Effect.map((value) => value.all))),
      available: Effect.fn("Model.available")(() => read().pipe(Effect.map((value) => value.available))),
      default: Effect.fn("Model.default")(function* () {
        const value = yield* read()
        const requested = value.data.defaultModel
        const model = requested && value.byProvider.get(requested.providerID)?.get(requested.modelID)
        return model?.enabled ? model : value.available[0]
      }),
      small: Effect.fn("Model.small")(function* (providerID) {
        const value = yield* read()
        const models = value.available.filter(
          (model) =>
            model.providerID === providerID &&
            model.status === "active" &&
            model.capabilities.input.some((item) => item.startsWith("text")) &&
            model.capabilities.output.some((item) => item.startsWith("text")),
        )
        return ["gpt-luna", "gemini-flash-lite", "gemini-flash", "claude-haiku"].flatMap(
          (family) => models.find((model) => model.family === family) ?? [],
        )[0]
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Provider.node, Bus.node, Location.node] })

export function compatibility(input: unknown): Compatibility | undefined {
  if (typeof input === "string") return { reasoningField: input }
  if (typeof input !== "object" || input === null || Array.isArray(input) || !("field" in input)) return undefined
  return typeof input.field === "string" ? { reasoningField: input.field } : undefined
}

export function parse(input: string): { providerID: Provider.ID; modelID: ID } {
  const index = input.indexOf("/")
  return {
    providerID: Provider.ID.make(index === -1 ? input : input.slice(0, index)),
    modelID: ID.make(index === -1 ? "" : input.slice(index + 1)),
  }
}

export * as Model from "./model.js"
