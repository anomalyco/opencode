import { createStore } from "solid-js/store"
import { dedupeWith } from "effect/Array"
import { createSimpleContext } from "./helper"
import { batch, createMemo, onCleanup } from "solid-js"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { useClient } from "./client"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import {
  availableModelVariant,
  createModelPreferenceRepository,
  cycleModelVariant,
  modelPreferenceKey,
  normalizeModelVariant,
  type ModelPreference,
  type ModelPreferenceModel,
} from "../model-preference"
import { useTheme, useThemes } from "./theme"
import { useToast } from "../ui/toast"
import { useRoute } from "./route"
import { useData } from "./data"
import { usePermission } from "./permission"
import { useLocation } from "./location"

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: providerID,
    modelID: rest.join("/"),
  }
}

export function recentModels(model: ModelPreferenceModel, recent: ModelPreferenceModel[]) {
  const seen = new Set<string>()
  return [model, ...recent]
    .filter((item) => {
      const key = modelPreferenceKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const data = useData()
    const client = useClient()
    const toast = useToast()
    const theme = useTheme()
    const { mode } = useThemes()
    const route = useRoute()
    const paths = useTuiPaths()
    const args = useArgs()
    const event = useEvent()
    const permission = usePermission()
    const location = useLocation()

    const models = () => data.location.model.list(location.ref)
    const providers = () => data.location.provider.list(location.ref)

    function isModelValid(model: ModelPreferenceModel) {
      return !!models()?.some((item) => item.providerID === model.providerID && item.id === model.modelID)
    }

    function getFirstValidModel(...modelFns: (() => ModelPreferenceModel | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (model && isModelValid(model)) return model
      }
    }

    function createAgent() {
      const agents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden),
      )
      const visibleAgents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => !agent.hidden),
      )
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
      })
      const colors = createMemo(() => {
        const step = mode() === "light" ? 800 : 200
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
          return agents().find((agent) => agent.id === agentStore.current) ?? agents().at(0)
        },
        set(id: string) {
          if (!agents().some((agent) => agent.id === id))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${id}`,
              duration: 3000,
            })
          setAgentStore("current", id)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((agent) => agent.id === current.id) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            setAgentStore("current", value.id)
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
      })
      const [selectionState, setSelectionState] = createStore<{
        newSessionModelByLocationAgent: Record<string, ModelPreferenceModel | undefined>
        draftBySession: Record<string, ModelSelection | undefined>
      }>({
        newSessionModelByLocationAgent: {},
        draftBySession: {},
      })

      const repository = createModelPreferenceRepository(path.join(paths.state, "model.json"))
      const pendingSelectionCommits = new Map<string, string>()
      const selectionKey = (value: ModelSelection) =>
        `${modelPreferenceKey(value)}:${normalizeModelVariant(value.variant) ?? "default"}`
      const saveState = {
        pending: false,
      }

      function savePreferences() {
        if (!preferences.ready) {
          saveState.pending = true
          return
        }
        saveState.pending = false
        void repository
          .patch({
            recent: preferences.recent,
            favorite: preferences.favorite,
            variant: preferences.variant,
          })
          .catch(() => undefined)
      }

      repository
        .load()
        .then((value) => {
          setPreferences("recent", value.recent)
          setPreferences("favorite", value.favorite)
          setPreferences("variant", value.variant)
        })
        .catch(() => {})
        .finally(() => {
          setPreferences("ready", true)
          if (saveState.pending) savePreferences()
        })

      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = parseModel(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

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
        const info = models()?.find((item) => item.providerID === model.providerID && item.id === model.modelID)
        return {
          ...model,
          variant: availableModelVariant(
            preferences.variant[modelPreferenceKey(model)],
            info?.variants?.map((item) => item.id) ?? [],
          ),
        }
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
        return selectionState.draftBySession[sessionID] ?? durableSelection(sessionID)
      }

      function setSessionDraft(sessionID: string, selection: ModelSelection) {
        const durable = durableSelection(sessionID)
        setSelectionState(
          "draftBySession",
          sessionID,
          durable && selectionKey(durable) === selectionKey(selection) ? undefined : selection,
        )
      }

      function selectModel(model: ModelPreferenceModel) {
        if (route.data.type === "session") {
          const sessionID = route.data.sessionID
          const current = sessionSelection(sessionID)
          const preferred =
            current?.providerID === model.providerID && current.modelID === model.modelID
              ? current.variant
              : preferences.variant[modelPreferenceKey(model)]
          const info = models()?.find((item) => item.providerID === model.providerID && item.id === model.modelID)
          const variant = availableModelVariant(preferred, info?.variants?.map((item) => item.id) ?? [])
          setSessionDraft(sessionID, { ...model, variant })
          return true
        }
        const current = agent.current()
        if (!current) return false
        setSelectionState("newSessionModelByLocationAgent", locationAgentKey(current.id), model)
        return true
      }

      onCleanup(
        event.on("session.model.selected", (evt) => {
          const expected = pendingSelectionCommits.get(evt.data.sessionID)
          if (!expected) return
          const committed = selectionKey({
            providerID: evt.data.model.providerID,
            modelID: evt.data.model.id,
            variant: evt.data.model.variant,
          })
          if (committed !== expected) return
          pendingSelectionCommits.delete(evt.data.sessionID)
          const draft = selectionState.draftBySession[evt.data.sessionID]
          if (draft && selectionKey(draft) === committed)
            setSelectionState("draftBySession", evt.data.sessionID, undefined)
        }),
      )

      onCleanup(
        event.on("session.deleted", (evt) => {
          pendingSelectionCommits.delete(evt.data.sessionID)
          setSelectionState("draftBySession", evt.data.sessionID, undefined)
        }),
      )

      return {
        current: currentModel,
        selection: currentSelection,
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
        ) {
          const committed = selectionKey({ providerID: value.providerID, modelID: value.id, variant: value.variant })
          pendingSelectionCommits.set(sessionID, committed)
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
        recent() {
          return preferences.recent
        },
        favorite() {
          return preferences.favorite
        },
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
          const info = models()?.find((item) => item.providerID === value.providerID && item.id === value.modelID)
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? `${value.modelID} (unavailable)`,
            reasoning: (info?.variants?.length ?? 0) !== 0,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentSelection()
          if (!current) return
          const recent = recentModels(current, preferences.recent).filter(isModelValid)
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          let next = index === -1 ? (direction === 1 ? 0 : recent.length - 1) : index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          selectModel({ ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = preferences.favorite.filter((item) => isModelValid(item))
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
            index = favorites.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
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
          savePreferences()
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) return
            if (!selectModel(model)) return
            if (options?.recent) {
              setPreferences("recent", recentModels(model, preferences.recent))
              savePreferences()
            }
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) return
            const exists = preferences.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            const next = exists
              ? preferences.favorite.filter((x) => x.providerID !== model.providerID || x.modelID !== model.modelID)
              : [model, ...preferences.favorite]
            setPreferences(
              "favorite",
              next.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
            )
            savePreferences()
          })
        },
        variant: {
          selected() {
            return currentSelection()?.variant
          },
          current() {
            const v = this.selected()
            if (v && this.list().includes(v)) return v
            return undefined
          },
          list() {
            const m = currentSelection()
            if (!m) return []
            const info = models()?.find((item) => item.providerID === m.providerID && item.id === m.modelID)
            return info?.variants?.map((variant) => variant.id) ?? []
          },
          set(value: string | undefined) {
            const m = currentSelection()
            if (!m) return
            if (route.data.type === "session") {
              setSessionDraft(route.data.sessionID, { ...m, variant: normalizeModelVariant(value) })
            }
            setPreferences("variant", modelPreferenceKey(m), normalizeModelVariant(value))
            savePreferences()
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            this.set(cycleModelVariant(this.current(), variants))
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
