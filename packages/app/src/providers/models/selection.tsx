import { createSimpleContext } from "@opencode/ui/context"
import { base64Encode } from "@opencode/util/encode"
import { useParams } from "@solidjs/router"
import { batch, createEffect, createMemo, createRoot, createSignal, onCleanup, untrack } from "solid-js"
import { Predicate, Schema, SchemaGetter } from "effect"
import { useModels } from "@/providers/models/models"
import { useSettings } from "@/settings/model"
import { syncWhileBooting, useProviders } from "@/providers/catalog/providers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { usePlatform, type Platform } from "@/runtime/platform/platform"
import { hasCustomAgent, resolveAgent } from "./agent"
import {
  createModelSelectionState,
  editSelection,
  selectChosenModel,
  selectPreview,
  selectSession,
  selectVariant,
  storedSessions,
  transitionModelSelection,
  type AgentChoices,
  type ModelChoice,
  type ModelSelectionEffect,
  type ModelSelectionEvent,
  type Selection,
  type SelectionEdit,
} from "./selection-machine"
import {
  cycleModelVariant,
  durableVariantSelection,
  getConfiguredAgentVariant,
  INHERIT_VARIANT,
  resolveModelVariant,
  variantSelectionFrom,
  type VariantSelection,
} from "./variant"
import { useWorkspaceLocation } from "@/workspaces/location"
import { pathKey } from "@/workspaces/path-key"
import { useData } from "@/runtime/server/current"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey, type ServerScope } from "@/runtime/server/scope"
import { useConfiguredModel } from "./configured"

const ModelKeySchema = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
})

export type ModelKey = typeof ModelKeySchema.Type

const VariantSelectionSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inherit") }),
  Schema.Struct({ type: Schema.Literal("default") }),
  Schema.Struct({ type: Schema.Literal("named"), value: Schema.String }),
])

const ModelChoiceSchema = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: VariantSelectionSchema,
})

const SessionSchema = Schema.Struct({
  agent: Persistence.optional(Schema.String),
  choice: Persistence.optional(ModelChoiceSchema),
  choices: Persistence.optional(
    Schema.Record(
      Schema.String,
      Persistence.entry(Persistence.fallback(Schema.UndefinedOr(ModelChoiceSchema), () => undefined)),
    ),
  ),
})

type StoredSession = typeof SessionSchema.Type

const Current = Persistence.struct({
  session: Schema.Record(
    Schema.String,
    Persistence.entry(Persistence.fallback(Schema.UndefinedOr(SessionSchema), () => undefined)),
  ),
})

// Before `choice`, a selection stored `model` beside a `variant` where `null` was the explicit Default and an absent
// value inherited. Entries already in the current shape pass through: they never carry `model`.
const legacyChoice = {
  model: Persistence.optional(ModelKeySchema),
  variant: Persistence.optional(Schema.Union([Schema.String, Schema.Null, VariantSelectionSchema])),
}

const LegacySessionSchema = Persistence.legacy({
  ...legacyChoice,
  choices: Persistence.optional(
    Schema.Record(
      Schema.String,
      Persistence.entry(Persistence.fallback(Schema.UndefinedOr(Persistence.legacy(legacyChoice)), () => undefined)),
    ),
  ),
})

const LegacySessionsSchema = Persistence.optional(
  Schema.Record(
    Schema.String,
    Persistence.entry(Persistence.fallback(Schema.UndefinedOr(LegacySessionSchema), () => undefined)),
  ),
)

export const ModelSelectionSchema = Persistence.migrate(
  Current,
  Persistence.legacy({ session: LegacySessionsSchema, pick: LegacySessionsSchema }).pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => ({
        session: Object.fromEntries(
          Object.entries(
            value.session ??
              Object.fromEntries(Object.entries(value.pick ?? {}).filter(([key]) => key !== WORKSPACE_KEY)),
          ).map(([sessionID, entry]) => [sessionID, entry && migrateSession(entry)]),
        ),
      })),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

const WORKSPACE_KEY = "__workspace__"

function migrateSession(entry: typeof LegacySessionSchema.Type): typeof LegacySessionSchema.Type {
  return {
    ...entry,
    choice: entry.model ? migrateChoice(entry.model, entry.variant) : entry.choice,
    choices:
      entry.choices &&
      Object.fromEntries(
        Object.entries(entry.choices).map(([agent, choice]) => [
          agent,
          choice?.model ? migrateChoice(choice.model, choice.variant) : choice,
        ]),
      ),
  }
}

function migrateChoice(model: ModelKey, variant: string | null | VariantSelection | undefined) {
  return {
    providerID: model.providerID,
    modelID: model.modelID,
    variant: Predicate.isObject(variant) ? variant : variantSelectionFrom(variant),
  }
}

type Workspace = ReturnType<typeof openWorkspace>

// Selections belong to a workspace, not to the provider showing it: a draft promotes into a workspace no provider shows
// yet, and providers for the same workspace share one machine. The entry closes when the last holder releases it.
const workspaces = new Map<string, Workspace>()

function acquireWorkspace(scope: ServerScope, directory: string, platform: Platform) {
  const key = ScopedKey.from(scope, pathKey(directory))
  const workspace = workspaces.get(key) ?? openWorkspace(key, scope, directory, platform)
  workspaces.set(key, workspace)

  return { workspace, release: workspace.retain() }
}

function openWorkspace(key: string, scope: ServerScope, directory: string, platform: Platform) {
  return createRoot((dispose) => {
    const [saved, setSaved, , savedReady] = persisted(
      Persist.serverWorkspace(scope, directory, "model-selection"),
      ModelSelectionSchema,
      { session: {} },
      platform,
    )

    const stored = () =>
      Object.fromEntries(Object.entries(saved.session).map(([sessionID, entry]) => [sessionID, readStored(entry)]))

    const [state, setState] = createSignal(
      createModelSelectionState(
        savedReady() ? { status: "ready", sessions: storedSessions(stored()) } : { status: "hydrating" },
      ),
    )

    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const viewers = new Map<string, number>()
    let holders = 0

    const dispatch = (event: ModelSelectionEvent) => {
      const prev = untrack(state)
      const next = transitionModelSelection(prev, event)

      if (next.state === prev && next.effects.length === 0) return prev
      batch(() => {
        setState(next.state)
        next.effects.forEach(run)
      })

      return next.state
    }

    const stopTimer = (sessionID: string) => {
      clearTimeout(timers.get(sessionID))
      timers.delete(sessionID)
    }

    const run = (effect: ModelSelectionEffect) => {
      if (effect.type === "persist.write") {
        // A fresh object per write: the store merges into what it holds, so machine objects never enter it.
        setSaved("session", { [effect.sessionID]: effect.selection && writeStored(effect.selection) })

        return
      }

      if (effect.type === "ack-timer.start") {
        stopTimer(effect.sessionID)
        timers.set(
          effect.sessionID,
          setTimeout(() => {
            timers.delete(effect.sessionID)
            dispatch({ type: "commit.timed-out", sessionID: effect.sessionID, attempt: effect.attempt })
          }, effect.timeoutMs),
        )

        return
      }

      if (effect.type === "ack-timer.clear") return stopTimer(effect.sessionID)

      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }

    createEffect(() => {
      if (!savedReady()) return
      untrack(() => dispatch({ type: "hydrated", sessions: stored() }))
    })

    // Closing waits for a pending load, so a selection promoted into an unshown workspace is written, not dropped.
    const close = () => {
      if (holders > 0) return
      dispatch({ type: "disposed" })

      if (workspaces.get(key) === workspace) workspaces.delete(key)
      dispose()
    }

    const workspace = {
      state,
      dispatch,
      ready: () => state().status === "ready",
      /** Whether any provider shows the Session now. */
      visible: (sessionID: string) => viewers.has(sessionID),
      view(sessionID: string) {
        viewers.set(sessionID, (viewers.get(sessionID) ?? 0) + 1)

        return () => {
          const count = (viewers.get(sessionID) ?? 1) - 1

          if (count > 0) viewers.set(sessionID, count)

          if (count <= 0) viewers.delete(sessionID)
        }
      },
      retain() {
        holders += 1

        return () => {
          holders -= 1

          if (holders > 0) return

          if (untrack(savedReady)) return close()
          void savedReady.promise?.then(close, close)
        }
      },
    }

    return workspace
  })
}

function readStored(entry: StoredSession | undefined): Selection | undefined {
  if (!entry) return

  return {
    agent: entry.agent,
    choice: entry.choice && copyChoice(entry.choice),
    choices: Object.fromEntries(
      Object.entries(entry.choices ?? {}).flatMap(([agent, choice]) => (choice ? [[agent, copyChoice(choice)]] : [])),
    ),
  }
}

function writeStored(selection: Selection): StoredSession {
  return {
    agent: selection.agent,
    choice: selection.choice && copyChoice(selection.choice),
    choices: Object.fromEntries(
      Object.entries(selection.choices).map(([agent, choice]) => [agent, copyChoice(choice)]),
    ),
  }
}

function copyChoice(choice: ModelChoice): ModelChoice {
  return { providerID: choice.providerID, modelID: choice.modelID, variant: { ...choice.variant } }
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const params = useParams()
    const sdk = useWorkspaceLocation()
    const data = useData()
    const serverSDK = useServerSDK()
    const platform = usePlatform()
    const providers = useProviders(() => sdk().directory)
    const models = useModels()
    const settings = useSettings()
    const configuredModel = useConfiguredModel()

    const id = createMemo(() => params.id || undefined)

    const list = createMemo(() =>
      normalizeAgentList(data.location.agent.list({ directory: sdk().directory }) ?? []).filter(
        (item) => item.mode !== "subagent" && !item.hidden,
      ),
    )

    createEffect(() => {
      if (serverSDK.connection.status() !== "connected") return
      const directory = sdk().directory

      if (!directory) return
      void syncWhileBooting(() => data.location.agent.sync({ directory })).catch(() => undefined)
    })

    const agentsVisible = createMemo(() => settings.visibility.customAgents() || hasCustomAgent(list()))
    const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))

    // Follows the routed Session's directory: the Session route keeps this provider while tabs switch workspaces.
    const workspace = createMemo(() => {
      const opened = acquireWorkspace(serverSDK.scope, sdk().directory, platform)
      onCleanup(opened.release)

      return opened.workspace
    })

    createEffect(() => {
      const session = id()

      if (session) onCleanup(workspace().view(session))
    })

    // A draft's selection is this provider's own, so two drafts on one workspace choose independently.
    const [draft, setDraft] = createSignal<Selection>()

    const validModel = (model: Pick<ModelKey, "providerID" | "modelID">) => {
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

    const scope = createMemo<Selection | undefined>(() => {
      const session = id()

      return session ? selectSession(workspace().state(), session) : draft()
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

    const fallback = createMemo(() => firstModel(configuredModel, recentModel, defaultModel))

    const durable = () => {
      const session = id()

      return session ? data.session.get(session) : undefined
    }

    const edit = (change: SelectionEdit) => {
      const session = id()

      if (session) {
        workspace().dispatch({ type: "edited", sessionID: session, edit: change })

        return
      }

      setDraft((current) => editSelection(current, change))
    }

    const agent = {
      list,
      visible: agentsVisible,
      current() {
        return pickAgent(scope()?.agent ?? durable()?.agent ?? (agentsVisible() ? list()[0]?.name : "build"))
      },
      set(name: string | undefined) {
        const item = pickAgent(name)

        if (!item) return

        batch(() => {
          const previous = snapshot()

          if (previous.agent === item.name) return
          edit({ type: "agent", agent: item.name, previous })
          // Pin both choices while the agent and model acknowledgments arrive separately.
          const selected = current()

          if (selected) model.set({ providerID: selected.provider.id, modelID: selected.id })
        })
      },
      move(direction: 1 | -1) {
        const items = list()

        if (items.length === 0) return

        let next = items.findIndex((item) => item.name === agent.current()?.name) + direction

        if (next < 0) next = items.length - 1

        if (next >= items.length) next = 0
        const item = items[next]

        if (!item) return
        agent.set(item.name)
      },
    }

    // The chosen model, kept even when the catalog no longer offers it.
    const key = createMemo<ModelKey | undefined>(() => {
      if (!configuredModel.ready()) return

      // Catalog availability must not replace a user's choice with a default on the next submission.
      return (
        selectChosenModel(scope(), durable(), agent.current()?.name) ??
        firstModel(() => agent.current()?.model, fallback)
      )
    })

    const current = createMemo(() => {
      const item = key()

      if (!item) return

      return models.find(item)
    })

    const ready = () => workspace().ready()

    // What `key` and the variant will resolve to once the Location's agents and config load, read from state already
    // here: a local selection, else the Session's durable model unless the local selection picked another agent.
    const preview = () => {
      if (!ready()) return

      return selectPreview(scope(), durable())
    }

    const configured = (model = current()) => {
      const item = agent.current()

      if (!item || !model) return
      const global = configuredModel()

      return (
        getConfiguredAgentVariant({
          agent: { model: item.model, variant: item.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        }) ??
        getConfiguredAgentVariant({
          agent: { model: global, variant: global?.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        })
      )
    }

    const snapshot = () => {
      const selected = current()

      return {
        agent: agent.current()?.name,
        choice: selected
          ? {
              providerID: selected.provider.id,
              modelID: selected.id,
              variant: durableVariantSelection(model.variant.current()),
            }
          : undefined,
      }
    }

    const choose = (item: ModelKey, variant: VariantSelection) =>
      edit({
        type: "model",
        agent: agent.current()?.name,
        choice: { providerID: item.providerID, modelID: item.modelID, variant },
      })

    const recent = createMemo(() => models.recent.list().filter(validModel).map(models.find).filter(Boolean))

    const favorite = createMemo(() =>
      models.favorite
        .list()
        .filter(validModel)
        .map(models.find)
        .filter((item): item is NonNullable<typeof item> => !!item),
    )

    const reconcile = (sessionID: string) => {
      const target = workspace()
      target.dispatch({
        type: "commit.reconciled",
        sessionID,
        visible: target.visible(sessionID),
        durable: data.session.get(sessionID),
      })
    }

    onCleanup(serverSDK.event.on("session.model.selected", (event) => reconcile(event.data.sessionID)))
    onCleanup(serverSDK.event.on("session.agent.selected", (event) => reconcile(event.data.sessionID)))
    onCleanup(
      serverSDK.event.on("session.deleted", (event) =>
        workspace().dispatch({ type: "session.deleted", sessionID: event.data.sessionID }),
      ),
    )

    const model = {
      ready: Object.assign(() => models.ready() && configuredModel.ready(), { promise: models.ready.promise }),
      key,
      preview,
      current,
      recent,
      favorite: { list: favorite, toggle: models.favorite.toggle },
      list: models.list,
      trackSessionCommit(sessionID: string, selection: { agent: string; model: ModelKey; variant?: string }) {
        const target = workspace()

        const next = target.dispatch({
          type: "commit.tracked",
          sessionID,
          target: {
            agent: selection.agent,
            model: { providerID: selection.model.providerID, modelID: selection.model.modelID },
            variant: selection.variant,
          },
          visible: target.visible(sessionID),
          durable: data.session.get(sessionID),
        })

        const attempt = next.status === "disposed" ? 0 : next.attempt

        return () => {
          target.dispatch({ type: "commit.cancelled", sessionID, attempt })
        }
      },
      cycle(direction: 1 | -1) {
        const items = recent()
        const item = current()

        if (!item) return

        const index = items.findIndex((entry) => entry?.provider.id === item.provider.id && entry?.id === item.id)
        let next = index === -1 ? (direction === 1 ? 0 : items.length - 1) : index + direction

        if (next < 0) next = items.length - 1

        if (next >= items.length) next = 0

        const entry = items[next]

        if (!entry) return
        model.set({ providerID: entry.provider.id, modelID: entry.id })
      },
      set(item: ModelKey | undefined, options?: { recent?: boolean }) {
        batch(() => {
          if (item && !validModel(item)) return
          const previous = current()
          const same = item && previous?.provider.id === item.providerID && previous.id === item.modelID

          if (!item) {
            edit({ type: "model", agent: agent.current()?.name, choice: undefined })

            return
          }

          choose(item, same ? durableVariantSelection(model.variant.current()) : INHERIT_VARIANT)

          // A session selection owns its variant even when preferences change in another session.
          if (id() && !same) choose(item, durableVariantSelection(model.variant.current()))
          models.setVisibility(item, true)

          if (!options?.recent) return
          models.recent.push(item)
        })
      },
      visible(item: ModelKey) {
        return models.visible(item)
      },
      setVisibility(item: ModelKey, visible: boolean) {
        models.setVisibility(item, visible)
      },
      variant: {
        configured,
        current(item?: ModelKey) {
          const model = item ? models.find(item) : current()
          const same = !item || (current()?.provider.id === item.providerID && current()?.id === item.modelID)

          return resolveModelVariant({
            variants: Object.keys(model?.variants ?? {}),
            selected: same ? selectVariant(scope(), durable(), agent.current()?.name, validModel) : INHERIT_VARIANT,
            configured: configured(model),
            preferred: model ? models.variant.get({ providerID: model.provider.id, modelID: model.id }) : undefined,
          })
        },
        list() {
          const item = current()

          if (!item?.variants) return []

          return Object.keys(item.variants)
        },
        set(value: string | undefined) {
          batch(() => {
            const model = current()

            if (!model) return
            choose({ providerID: model.provider.id, modelID: model.id }, durableVariantSelection(value))
            models.variant.set({ providerID: model.provider.id, modelID: model.id }, value)
          })
        },
        cycle() {
          const items = this.list()

          if (items.length === 0) return
          this.set(
            cycleModelVariant({
              variants: items,
              selected: durableVariantSelection(this.current()),
              configured: undefined,
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
        ready,
        reset() {
          setDraft(undefined)
        },
        // Writes the started Session's selection into its workspace, shown or not, and leaves this draft empty.
        promote(
          dir: string,
          session: string,
          selection: { agent: string; model: ModelKey; variant: string | undefined; choices: AgentChoices },
        ) {
          setDraft(undefined)
          const target = acquireWorkspace(serverSDK.scope, dir, platform)
          target.workspace.dispatch({
            type: "session.promoted",
            sessionID: session,
            selection: {
              agent: selection.agent,
              choice: {
                providerID: selection.model.providerID,
                modelID: selection.model.modelID,
                variant: durableVariantSelection(selection.variant),
              },
              choices: selection.choices,
            },
            durable: data.session.get(session),
          })
          target.release()
        },
        restore(msg: { sessionID: string; agent: string; model: ModelKey }) {
          workspace().dispatch({
            type: "session.restored",
            sessionID: msg.sessionID,
            visible: msg.sessionID === id(),
            durable: data.session.get(msg.sessionID),
            agent: msg.agent,
            choice: {
              providerID: msg.model.providerID,
              modelID: msg.model.modelID,
              variant: durableVariantSelection(msg.model.variant),
            },
          })
        },
      },
    }

    return result
  },
})

export type ModelSelection = Omit<ReturnType<typeof useLocal>["model"], "trackSessionCommit" | "preview"> &
  Partial<Pick<ReturnType<typeof useLocal>["model"], "trackSessionCommit" | "preview">>
