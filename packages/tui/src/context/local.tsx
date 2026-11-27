import { createStore } from "solid-js/store"
import { dedupeWith } from "effect/Array"
import { createSimpleContext } from "./helper"
import { batch, createMemo, onCleanup } from "solid-js"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import {
  createModelPreferenceRepository,
  cycleModelSpeed,
  cycleModelVariant,
  favoriteModels,
  modelPreferenceKey,
  normalizeModelVariant,
  recentModels,
  type ModelPreference,
  type ModelPreferenceModel,
} from "../model-preference"
import { useTheme } from "./theme"
import { useNewDesigns } from "../config"
import { useToast } from "../ui/toast"
import { useRoute } from "./route"
import { useData } from "./data"
import { usePermission } from "./permission"
import { useLocation } from "./location"
import { parse } from "../util/model"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const data = useData()
    const toast = useToast()
    const theme = useTheme()
    const newDesigns = useNewDesigns()
    const route = useRoute()
    const paths = useTuiPaths()
    const args = useArgs()
    const event = useEvent()
    const permission = usePermission()
    const location = useLocation()

    const models = () => data.location.model.list(location.ref)
    const providers = () => data.location.provider.list(location.ref)

    // Indexed because the model picker looks up every model, and catalogs such as OpenRouter's hold thousands.
    const modelIndex = createMemo(
      () =>
        new Map(
          (models() ?? []).map((item) => [modelPreferenceKey({ providerID: item.providerID, modelID: item.id }), item]),
        ),
    )

    function findModel(model: ModelPreferenceModel) {
      return modelIndex().get(modelPreferenceKey(model))
    }

    function isModelValid(model: ModelPreferenceModel) {
      return !!findModel(model)
    }

    // A model that is another model served faster or slower ("gpt-5.5-fast") is offered as a speed of that model
    // instead of as an entry of its own. This is the model whose entry stands for it.
    function standardModel(model: ModelPreferenceModel): ModelPreferenceModel {
      const base = findModel(model)?.experimental?.speed?.base
      const standard = base && { providerID: model.providerID, modelID: base }
      return standard && isModelValid(standard) ? standard : model
    }

    function getFirstValidModel(...modelFns: (() => ModelPreferenceModel | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (model && isModelValid(model)) return model
      }
    }

    function createAgent() {
      const primaryAgents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => agent.mode !== "subagent"),
      )
      const agents = createMemo(() => primaryAgents().filter((agent) => !agent.hidden))
      const visibleAgents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => !agent.hidden),
      )
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
        draftBySession: {} as Record<string, { agent?: string } | undefined>,
      })
      onCleanup(event.on("session.deleted", (evt) => setAgentStore("draftBySession", evt.data.sessionID, undefined)))
      onCleanup(
        event.on("session.agent.selected", (evt) => {
          // Keep an entry after acknowledgment: CLI defaults must not override a user's later choice.
          if (agentStore.draftBySession[evt.data.sessionID]?.agent === evt.data.agent)
            setAgentStore("draftBySession", evt.data.sessionID, { agent: undefined })
        }),
      )
      const colors = createMemo(() => {
        // The new designs palette keeps its vivid accent at 400; 200 there is a muted tint.
        const step = newDesigns() ? 400 : 200
        return dedupeWith(
          theme.categorical.map((scale) => scale[step]),
          (first, second) => first.equals(second),
        )
      })
      return {
        list() {
          return agents()
        },
        current() {
          const draft = route.data.type === "session" ? agentStore.draftBySession[route.data.sessionID] : undefined
          const selected =
            route.data.type === "session"
              ? (draft?.agent ??
                (draft ? undefined : args.agent) ??
                data.session.get(route.data.sessionID)?.agent ??
                agentStore.current)
              : agentStore.current
          // A command can switch the session to a hidden agent, which stays out of the list but is still in use.
          return primaryAgents().find((agent) => agent.id === selected) ?? agents().at(0)
        },
        set(id: string) {
          if (!agents().some((agent) => agent.id === id))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${id}`,
              duration: 3000,
            })
          batch(() => {
            const changed = this.current()?.id !== id
            if (changed) model.remember()
            setAgentStore("current", id)
            if (route.data.type === "session") setAgentStore("draftBySession", route.data.sessionID, { agent: id })
            // Retain both selections while agent and model commits arrive separately.
            const selected = changed && route.data.type === "session" ? model.current() : undefined
            if (selected) model.set(selected)
          })
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((agent) => agent.id === current.id) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            this.set(value.id)
          })
        },
        color(id: string) {
          const index = visibleAgents().findIndex((agent) => agent.id === id)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) return RGBA.fromHex(agent.color)
          return colors()[index % colors().length]
        },
      }
    }

    const agent = createAgent()

    function createModel() {
      type ModelSelection = ModelPreferenceModel & { variant?: string }
      const [preferences, setPreferences] = createStore<ModelPreference & { ready: boolean }>({
        ready: false,
        recent: [],
        favorite: [],
        variant: {},
        speed: {},
      })
      const [selectionState, setSelectionState] = createStore<{
        newSessionModelByLocationAgent: Record<string, ModelPreferenceModel | undefined>
        selectionBySessionAgent: Record<string, Record<string, ModelSelection | undefined> | undefined>
      }>({
        newSessionModelByLocationAgent: {},
        selectionBySessionAgent: {},
      })

      // Saved entries may name a model at any of its speeds; the lists show each model once.
      const unique = (list: ModelPreferenceModel[]) =>
        dedupeWith(list.map(standardModel), (a, b) => modelPreferenceKey(a) === modelPreferenceKey(b))
      const recent = createMemo(() => unique(preferences.recent))
      const favorite = createMemo(() => unique(preferences.favorite))

      const speeds = (model: ModelPreferenceModel) =>
        (models() ?? []).filter(
          (item) => item.providerID === model.providerID && item.experimental?.speed?.base === model.modelID,
        )

      const repository = createModelPreferenceRepository(path.join(paths.state, "model.json"))
      const pendingSelectionCommits = new Map<string, { agentID: string; selection: string }>()
      const selectionKey = (value: ModelSelection) =>
        `${modelPreferenceKey(value)}:${normalizeModelVariant(value.variant) ?? "default"}`

      function applyPreferences(value: ModelPreference) {
        batch(() => {
          setPreferences("recent", value.recent)
          setPreferences("favorite", value.favorite)
          setPreferences("variant", value.variant)
          setPreferences("speed", value.speed)
          setPreferences("ready", true)
        })
      }

      onCleanup(repository.subscribe(applyPreferences))

      const configuredModel = createMemo(() => {
        const entry = data.location.config
          .list(location.ref)
          ?.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
        const configured = entry?.type === "document" ? entry.info.model : undefined
        if (!configured) return
        return typeof configured === "string"
          ? { ...parse(configured), variant: undefined }
          : { providerID: configured.providerID, modelID: configured.model, variant: configured.variant }
      })

      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = parse(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        const configured = configuredModel()
        if (configured && isModelValid(configured)) return configured

        for (const item of preferences.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const model = models()?.[0]
        if (!model) return undefined
        return {
          providerID: model.providerID,
          modelID: model.id,
        }
      })

      const newSessionModel = createMemo(() => {
        const a = agent.current()
        return getFirstValidModel(
          () => a && selectionState.newSessionModelByLocationAgent[locationAgentKey(a.id)],
          () => a?.model && { providerID: a.model.providerID, modelID: a.model.id },
          fallbackModel,
        )
      })

      const currentSelection = createMemo<ModelSelection | undefined>(() => {
        if (route.data.type === "session") return sessionSelection(route.data.sessionID)
        const model = newSessionModel()
        if (!model) return
        return preferredSelection(model)
      })

      const currentModel = createMemo(() => {
        const selection = currentSelection()
        if (!selection) return
        return { providerID: selection.providerID, modelID: selection.modelID }
      })

      function locationAgentKey(agentID: string) {
        const ref = location.ref ?? data.location.default()
        return `${JSON.stringify([ref.directory, ref.workspaceID])}:${agentID}`
      }

      function preferredSelection(model: ModelPreferenceModel): ModelSelection {
        // A model runs at the speed last used with it.
        const speed = preferences.speed[modelPreferenceKey(model)]
        const remembered = speed && speeds(model).find((item) => item.experimental?.speed?.id === speed)
        const target = remembered ? { providerID: model.providerID, modelID: remembered.id } : model
        const configured = agent.current()?.model
        const fallback = configuredModel()
        // A model's speeds share its variant. Preferences saved before then may name one of its speeds instead.
        const standard = standardModel(model)
        const preferred = [
          standard,
          target,
          ...speeds(standard).map((item) => ({ providerID: item.providerID, modelID: item.id })),
        ]
          .map((item) => preferences.variant[modelPreferenceKey(item)])
          .find((value) => value !== undefined)
        const variant = normalizeModelVariant(
          preferred ??
            (configured?.providerID === model.providerID && configured.id === model.modelID
              ? configured.variant
              : undefined) ??
            (fallback?.providerID === model.providerID && fallback.modelID === model.modelID
              ? fallback.variant
              : undefined),
        )
        const info = findModel(target)
        return {
          providerID: target.providerID,
          modelID: target.modelID,
          variant: info?.variants.some((item) => item.id === variant) ? variant : undefined,
        }
      }

      function durableSelection(sessionID: string): ModelSelection | undefined {
        const model = data.session.get(sessionID)?.model
        if (!model) return
        return {
          providerID: model.providerID,
          modelID: model.id,
          variant: normalizeModelVariant(model.variant),
        }
      }

      function sessionSelection(sessionID: string) {
        const current = agent.current()
        if (!current) return
        const session = data.session.get(sessionID)
        const selected =
          selectionState.selectionBySessionAgent[sessionID]?.[current.id] ??
          (!session?.agent || session.agent === current.id ? durableSelection(sessionID) : undefined)
        if (selected) {
          const info = models()?.find((item) => item.providerID === selected.providerID && item.id === selected.modelID)
          return {
            ...selected,
            variant:
              !info || info.variants.some((variant) => variant.id === selected.variant) ? selected.variant : undefined,
          }
        }
        const model = newSessionModel()
        return model && preferredSelection(model)
      }

      function setSessionSelection(sessionID: string, agentID: string, selection: ModelSelection | undefined) {
        setSelectionState("selectionBySessionAgent", sessionID, {
          ...selectionState.selectionBySessionAgent[sessionID],
          [agentID]: selection,
        })
      }

      function setSessionDraft(sessionID: string, selection: ModelSelection) {
        const current = agent.current()
        if (!current) return
        const durable = durableSelection(sessionID)
        const session = data.session.get(sessionID)
        setSessionSelection(
          sessionID,
          current.id,
          (!session?.agent || session.agent === current.id) &&
            durable &&
            selectionKey(durable) === selectionKey(selection)
            ? undefined
            : selection,
        )
      }

      function selectModel(model: ModelPreferenceModel) {
        if (route.data.type === "session") {
          const sessionID = route.data.sessionID
          const current = sessionSelection(sessionID)
          setSessionDraft(
            sessionID,
            current?.providerID === model.providerID && current.modelID === model.modelID
              ? current
              : preferredSelection(model),
          )
          return true
        }
        const current = agent.current()
        if (!current) return false
        setSelectionState("newSessionModelByLocationAgent", locationAgentKey(current.id), model)
        return true
      }

      function reconcileSessionSelection(sessionID: string) {
        const expected = pendingSelectionCommits.get(sessionID)
        const durable = durableSelection(sessionID)
        if (!expected || !durable || data.session.get(sessionID)?.agent !== expected.agentID) return
        if (selectionKey(durable) !== expected.selection) return
        pendingSelectionCommits.delete(sessionID)
        // Inactive agents keep their remembered choices after another agent commits.
        if (
          route.data.type !== "session" ||
          route.data.sessionID !== sessionID ||
          agent.current()?.id !== expected.agentID
        )
          return
        const draft = selectionState.selectionBySessionAgent[sessionID]?.[expected.agentID]
        if (draft && selectionKey(draft) === expected.selection)
          setSessionSelection(sessionID, expected.agentID, undefined)
      }

      onCleanup(event.on("session.model.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))
      onCleanup(event.on("session.agent.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))

      onCleanup(
        event.on("session.deleted", (evt) => {
          pendingSelectionCommits.delete(evt.data.sessionID)
          setSelectionState("selectionBySessionAgent", evt.data.sessionID, undefined)
        }),
      )

      return {
        current: currentModel,
        selection: currentSelection,
        remember() {
          const current = agent.current()
          const selection = currentSelection()
          if (route.data.type !== "session" || !current || !selection) return
          setSessionSelection(route.data.sessionID, current.id, { ...selection })
        },
        available(model = currentModel()) {
          return model ? isModelValid(model) : false
        },
        trackSessionCommit(
          sessionID: string,
          value: {
            providerID: string
            id: string
            variant?: string
          },
          agentID: string,
        ) {
          const committed = {
            agentID,
            selection: selectionKey({ providerID: value.providerID, modelID: value.id, variant: value.variant }),
          }
          pendingSelectionCommits.set(sessionID, committed)
          // An unchanged model emits no event; the agent may be the only durable change.
          reconcileSessionSelection(sessionID)
          return () => {
            if (pendingSelectionCommits.get(sessionID) === committed) pendingSelectionCommits.delete(sessionID)
          }
        },
        get ready() {
          return preferences.ready
        },
        get catalogReady() {
          return models() !== undefined
        },
        /** The current model at its standard speed: the entry that stands for it in a list of models. */
        standard: createMemo(() => {
          const model = currentModel()
          return model && standardModel(model)
        }),
        /** Whether the model is offered as a speed of another model instead of as an entry of its own. */
        isSpeed(model: ModelPreferenceModel) {
          return modelPreferenceKey(standardModel(model)) !== modelPreferenceKey(model)
        },
        recent,
        favorite,
        parsed: createMemo(() => {
          const value = currentSelection()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = providers()?.find((item) => item.id === value.providerID)
          const info = findModel(value)
          return {
            provider: provider?.name ?? value.providerID,
            // The speed shows beside the name, so the name is the model's own.
            model: findModel(standardModel(value))?.name ?? `${value.modelID} (unavailable)`,
            reasoning: (info?.variants?.length ?? 0) !== 0,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentSelection()
          if (!current) return
          const list = recent().filter(isModelValid)
          const key = modelPreferenceKey(standardModel(current))
          const index = list.findIndex((item) => modelPreferenceKey(item) === key)
          let next = index === -1 ? (direction === 1 ? 0 : list.length - 1) : index + direction
          if (next < 0) next = list.length - 1
          if (next >= list.length) next = 0
          const val = list[next]
          if (!val) return
          selectModel({ ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = favorite().filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentSelection()
          let index = -1
          if (current) {
            const key = modelPreferenceKey(standardModel(current))
            index = favorites.findIndex((item) => modelPreferenceKey(item) === key)
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          if (!selectModel({ ...next })) return
          setPreferences("recent", recentModels(next, preferences.recent))
          void repository.addRecent(next).catch(() => undefined)
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) return
            if (!selectModel(model)) return
            if (options?.recent) {
              setPreferences("recent", recentModels(model, preferences.recent))
              void repository.addRecent(model).catch(() => undefined)
            }
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) return
            // An entry saved for the model at another speed is the same favorite.
            const key = modelPreferenceKey(standardModel(model))
            const same = (item: ModelPreferenceModel) => modelPreferenceKey(standardModel(item)) === key
            const exists = preferences.favorite.some(same)
            setPreferences("favorite", favoriteModels(model, preferences.favorite, !exists, same))
            void repository.setFavorite(model, !exists, same).catch(() => undefined)
          })
        },
        variant: {
          selected() {
            return currentSelection()?.variant
          },
          current() {
            return this.selected()
          },
          list() {
            const m = currentSelection()
            if (!m) return []
            return findModel(m)?.variants?.map((variant) => variant.id) ?? []
          },
          set(value: string | undefined) {
            const m = currentSelection()
            if (!m) return
            if (route.data.type === "session") {
              setSessionDraft(route.data.sessionID, { ...m, variant: normalizeModelVariant(value) })
            }
            // A model's speeds share its variant.
            const standard = standardModel(m)
            setPreferences("variant", modelPreferenceKey(standard), value ?? "default")
            void repository.saveVariant(standard, value).catch(() => undefined)
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            this.set(cycleModelVariant(this.current(), variants))
          },
        },
        speed: {
          /** Undefined is the model's standard speed. */
          current() {
            const m = currentModel()
            if (!m || modelPreferenceKey(standardModel(m)) === modelPreferenceKey(m)) return
            return findModel(m)?.experimental?.speed?.id
          },
          /** The current model's other speeds, slowest first. */
          list() {
            const m = currentModel()
            if (!m) return []
            const standard = standardModel(m)
            // Catalogs from older servers may list a model without prices.
            const price = findModel(standard)?.cost?.[0]?.input
            return speeds(standard).flatMap((item) => {
              const speed = item.experimental?.speed
              if (!speed) return []
              return {
                id: speed.id,
                faster: speed.faster,
                /** Its input price against the standard speed's, when the model has prices. */
                price: price && item.cost?.[0] ? item.cost[0].input / price : undefined,
              }
            })
          },
          set(value: string | undefined) {
            const m = currentSelection()
            if (!m) return
            const standard = standardModel(m)
            const target = value
              ? speeds(standard).find((item) => item.experimental?.speed?.id === value)?.id
              : standard.modelID
            if (!target) return
            batch(() => {
              setPreferences("speed", modelPreferenceKey(standard), value)
              void repository.saveSpeed(standard, value).catch(() => undefined)
              if (route.data.type === "session") return setSessionDraft(route.data.sessionID, { ...m, modelID: target })
              // A new session starts on the model, which runs at the speed just saved for it.
              const current = agent.current()
              if (current) setSelectionState("newSessionModelByLocationAgent", locationAgentKey(current.id), standard)
            })
          },
          cycle() {
            const list = this.list()
            if (list.length === 0) return
            this.set(cycleModelSpeed(this.current(), list))
          },
        },
      }
    }

    const model = createModel()

    function createSession() {
      const [sessionStore, setSessionStore] = createStore<{
        ready: boolean
        pinned: string[]
      }>({
        ready: false,
        pinned: [],
      })

      const filePath = path.join(paths.state, "session.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!sessionStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, {
          pinned: sessionStore.pinned,
        })
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const pinned = (x as Record<string, unknown>).pinned
          if (Array.isArray(pinned))
            setSessionStore(
              "pinned",
              pinned.filter((item): item is string => typeof item === "string"),
            )
        })
        .catch(() => {})
        .finally(() => {
          setSessionStore("ready", true)
          if (state.pending) save()
        })

      const slots = createMemo(() => {
        const existing = new Set(
          data.session
            .list()
            .filter((x) => x.parentID === undefined)
            .map((x) => x.id),
        )
        return sessionStore.pinned.filter((id) => existing.has(id)).slice(0, 9)
      })

      function prune(sessionID: string) {
        batch(() => {
          if (sessionStore.pinned.includes(sessionID)) {
            setSessionStore(
              "pinned",
              sessionStore.pinned.filter((x) => x !== sessionID),
            )
          }
          save()
        })
      }

      event.on("session.deleted", (evt) => {
        prune(evt.data.sessionID)
      })

      return {
        get ready() {
          return sessionStore.ready
        },
        pinned() {
          return sessionStore.pinned
        },
        slots,
        isPinned(sessionID: string) {
          return sessionStore.pinned.includes(sessionID)
        },
        togglePin(sessionID: string) {
          batch(() => {
            const exists = sessionStore.pinned.includes(sessionID)
            const next = exists
              ? sessionStore.pinned.filter((x) => x !== sessionID)
              : [...sessionStore.pinned, sessionID]
            setSessionStore("pinned", next)
            save()
          })
        },
        quickSwitch(slot: number) {
          const target = slots()[slot - 1]
          if (!target) return
          if (route.data.type === "session" && route.data.sessionID === target) return
          route.navigate({ type: "session", sessionID: target })
        },
      }
    }

    const session = createSession()

    const result = {
      model,
      agent,
      session,
      permission,
    }
    return result
  },
})
