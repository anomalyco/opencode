import { createSimpleContext } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/util/encode"
import { useParams } from "@solidjs/router"
import { batch, createEffect, createMemo, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema, SchemaGetter } from "effect"
import { useModels } from "@/providers/models/models"
import { useSettings } from "@/settings/model"
import { useProviders } from "@/providers/catalog/providers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { hasCustomAgent, resolveAgent } from "./agent"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./variant"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useData } from "@/runtime/server/current"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey, type ServerScope } from "@/runtime/server/scope"

const ModelKeySchema = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
})
export type ModelKey = typeof ModelKeySchema.Type

const StateSchema = Schema.Struct({
  agent: Persistence.optional(Schema.String),
  model: Persistence.optional(ModelKeySchema),
  variant: Persistence.optional(Schema.NullOr(Schema.String)),
})
type State = typeof StateSchema.Type

const SessionsSchema = Schema.Record(
  Schema.String,
  Schema.mutableKey(Persistence.fallback(Schema.UndefinedOr(StateSchema), () => undefined)),
)

const Current = Persistence.struct({ session: SessionsSchema })

export const ModelSelectionSchema = Persistence.migrate(
  Current,
  Schema.Struct({
    session: Persistence.optional(Schema.Record(Schema.String, Schema.Unknown)),
    pick: Persistence.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }).pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => ({
        session:
          value.session ??
          Object.fromEntries(Object.entries(value.pick ?? {}).filter(([key]) => key !== WORKSPACE_KEY)),
      })),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

const WORKSPACE_KEY = "__workspace__"
const handoff = new Map<string, State>()

const handoffKey = (scope: ServerScope, dir: string, id: string) => ScopedKey.from(scope, dir, id)

const clone = (value: State | undefined) => {
  if (!value) return
  return {
    ...value,
    model: value.model ? { ...value.model } : undefined,
  } satisfies State
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const params = useParams()
    const sdk = useWorkspaceLocation()
    const data = useData()
    const serverSDK = useServerSDK()
    const providers = useProviders(() => sdk().directory)
    const models = useModels()
    const settings = useSettings()

    const id = createMemo(() => params.id || undefined)
    const list = createMemo(() =>
      normalizeAgentList(data.location.agent.list({ directory: sdk().directory }) ?? []).filter(
        (item) => item.mode !== "subagent" && !item.hidden,
      ),
    )
    const agentsVisible = createMemo(() => settings.visibility.customAgents() || hasCustomAgent(list()))
    const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))

    const [saved, setSaved, , savedReady] = persisted(
      Persist.serverWorkspace(serverSDK.scope, sdk().directory, "model-selection"),
      ModelSelectionSchema,
      { session: {} },
    )

    const [store, setStore] = createStore<{
      current?: string
      draft?: State
      promoting?: State
      last?: {
        type: "agent" | "model" | "variant"
        agent?: string
        model?: ModelKey | null
        variant?: string | null
      }
    }>({
      current: list()[0]?.name,
      draft: undefined,
      last: undefined,
    })

    const validModel = (model: ModelKey) => {
      const provider = providers.all().get(model.providerID)
      return !!provider?.models[model.modelID] && connected().has(model.providerID)
    }

    const firstModel = (...items: Array<() => ModelKey | undefined>) => {
      for (const item of items) {
        const model = item()
        if (!model) continue
        if (validModel(model)) return model
      }
    }

    const pickAgent = (name: string | undefined) => {
      return resolveAgent(list(), name)
    }

    createEffect(() => {
      const items = list()
      if (items.length === 0) {
        if (store.current !== undefined) setStore("current", undefined)
        return
      }
      if (items.some((item) => item.name === store.current)) return
      setStore("current", items[0]?.name)
    })

    const scope = createMemo<State | undefined>(() => {
      const session = id()
      if (!session) return store.draft ?? store.promoting
      return saved.session[session] ?? handoff.get(handoffKey(serverSDK.scope, sdk().directory, session))
    })

    createEffect(() => {
      const session = id()
      if (!session) return

      const key = handoffKey(serverSDK.scope, sdk().directory, session)
      const next = handoff.get(key)
      if (!next) return
      if (saved.session[session] !== undefined) {
        handoff.delete(key)
        setStore("promoting", undefined)
        return
      }

      setSaved("session", session, clone(next))
      handoff.delete(key)
      setStore("promoting", undefined)
    })

    const recentModel = () => {
      for (const item of models.recent.list()) {
        if (validModel(item)) return item
      }
    }

    const defaultModel = () => {
      for (const provider of providers.connected()) {
        const first = Object.values(provider.models)[0]
        if (!first) continue
        const model = { providerID: provider.id, modelID: first.id }
        if (validModel(model)) return model
      }
    }

    const fallback = createMemo<ModelKey | undefined>(() => recentModel() ?? defaultModel())

    const agent = {
      list,
      visible: agentsVisible,
      current() {
        return pickAgent(agentsVisible() ? (scope()?.agent ?? store.current) : "build")
      },
      set(name: string | undefined) {
        const item = pickAgent(name)
        if (!item) {
          setStore("current", undefined)
          return
        }

        batch(() => {
          setStore("current", item.name)
          setStore("last", {
            type: "agent",
            agent: item.name,
            model: item.model,
            variant: item.variant ?? null,
          })
          const prev = scope()
          const next = {
            agent: item.name,
            model: item.model ?? prev?.model,
            variant: item.variant ?? prev?.variant,
          } satisfies State
          const session = id()
          if (session) {
            setSaved("session", session, next)
            return
          }
          setStore("draft", next)
        })
      },
      move(direction: 1 | -1) {
        const items = list()
        if (items.length === 0) {
          setStore("current", undefined)
          return
        }

        let next = items.findIndex((item) => item.name === agent.current()?.name) + direction
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0
        const item = items[next]
        if (!item) return
        agent.set(item.name)
      },
    }

    const current = createMemo(() => {
      const item = firstModel(
        () => scope()?.model,
        () => agent.current()?.model,
        fallback,
      )
      if (!item) return
      return models.find(item)
    })

    const configured = () => {
      const item = agent.current()
      const model = current()
      if (!item || !model) return
      return getConfiguredAgentVariant({
        agent: { model: item.model, variant: item.variant },
        model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
      })
    }

    const selected = () => scope()?.variant

    const snapshot = () => {
      const model = current()
      return {
        agent: agent.current()?.name,
        model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
        variant: selected(),
      } satisfies State
    }

    const write = (next: Partial<State>) => {
      const state = {
        ...(scope() ?? { agent: agent.current()?.name }),
        ...next,
      } satisfies State

      const session = id()
      if (session) {
        setSaved("session", session, state)
        return
      }
      setStore("draft", state)
    }

    const recent = createMemo(() => models.recent.list().map(models.find).filter(Boolean))

    const model = {
      ready: models.ready,
      current,
      recent,
      list: models.list,
      cycle(direction: 1 | -1) {
        const items = recent()
        const item = current()
        if (!item) return

        const index = items.findIndex((entry) => entry?.provider.id === item.provider.id && entry?.id === item.id)
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0

        const entry = items[next]
        if (!entry) return
        model.set({ providerID: entry.provider.id, modelID: entry.id })
      },
      set(item: ModelKey | undefined, options?: { recent?: boolean }) {
        startTransition(() =>
          batch(() => {
            setStore("last", {
              type: "model",
              agent: agent.current()?.name,
              model: item ?? null,
              variant: selected(),
            })
            write({ model: item })
            if (!item) return
            models.setVisibility(item, true)
            if (!options?.recent) return
            models.recent.push(item)
          }),
        )
      },
      visible(item: ModelKey) {
        return models.visible(item)
      },
      setVisibility(item: ModelKey, visible: boolean) {
        models.setVisibility(item, visible)
      },
      variant: {
        configured,
        selected,
        current() {
          const resolved = resolveModelVariant({
            variants: this.list(),
            selected: this.selected(),
            configured: this.configured(),
          })
          if (resolved) return resolved
          const model = current()
          if (!model) return
          const saved = models.variant.get({ providerID: model.provider.id, modelID: model.id })
          if (saved && this.list().includes(saved)) return saved
        },
        list() {
          const item = current()
          if (!item?.variants) return []
          return Object.keys(item.variants)
        },
        set(value: string | undefined) {
          startTransition(() =>
            batch(() => {
              const model = current()
              setStore("last", {
                type: "variant",
                agent: agent.current()?.name,
                model: model ? { providerID: model.provider.id, modelID: model.id } : null,
                variant: value ?? null,
              })
              write({ variant: value ?? null })
              if (model) {
                models.variant.set({ providerID: model.provider.id, modelID: model.id }, value ?? undefined)
              }
            }),
          )
        },
        cycle() {
          const items = this.list()
          if (items.length === 0) return
          this.set(
            cycleModelVariant({
              variants: items,
              selected: this.selected(),
              configured: this.configured(),
            }),
          )
        },
      },
    }

    const result = {
      slug: createMemo(() => base64Encode(sdk().directory)),
      model,
      agent,
      session: {
        ready: savedReady,
        reset() {
          setStore({ draft: undefined, promoting: undefined })
        },
        promote(dir: string, session: string, state?: State) {
          const next = clone(state ?? snapshot())
          if (!next) return
          const key = handoffKey(serverSDK.scope, dir, session)
          handoff.set(key, next)

          if (dir === sdk().directory) {
            setSaved("session", session, next)
          }

          setStore("promoting", next)
          setStore("draft", undefined)
        },
        restore(msg: { sessionID: string; agent: string; model: ModelKey }) {
          const session = id()
          if (!session) return
          if (msg.sessionID !== session) return
          if (saved.session[session] !== undefined) return
          if (handoff.has(handoffKey(serverSDK.scope, sdk().directory, session))) return

          setSaved("session", session, {
            agent: msg.agent,
            model: msg.model,
            variant: msg.model?.variant ?? null,
          })
        },
      },
    }
    return result
  },
})

export type ModelSelection = ReturnType<typeof useLocal>["model"]
