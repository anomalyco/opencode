import { createStore } from "solid-js/store"
import { dedupeWith } from "effect/Array"
import { createSimpleContext } from "./helper"
import { batch, createMemo } from "solid-js"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { useClient } from "./client"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import {
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

export function sessionModelSelection(
  sessionID: string | undefined,
  drafts: Record<string, ModelPreferenceModel | undefined>,
  durable: ModelPreferenceModel | undefined,
  fallback: ModelPreferenceModel | undefined,
) {
  if (!sessionID) return fallback
  return drafts[`session:${sessionID}`] ?? durable
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
      const [modelStore, setModelStore] = createStore<
        ModelPreference & {
          ready: boolean
          model: Record<string, ModelPreferenceModel | undefined>
          sessionVariant: Record<string, string | null | undefined>
        }
      >({
        ready: false,
        model: {},
        sessionVariant: {},
        recent: [],
        favorite: [],
        variant: {},
      })

      const repository = createModelPreferenceRepository(path.join(paths.state, "model.json"))
      const pendingCommits = new Map<string, string>()
      const commitKey = (value: ModelPreferenceModel & { variant?: string }) =>
        `${modelPreferenceKey(value)}:${normalizeModelVariant(value.variant) ?? "default"}`
      const state = {
        pending: false,
      }

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void repository
          .patch({
            recent: modelStore.recent,
            favorite: modelStore.favorite,
            variant: modelStore.variant,
          })
          .catch(() => undefined)
      }

      repository
        .load()
        .then((value) => {
          setModelStore("recent", value.recent)
          setModelStore("favorite", value.favorite)
          setModelStore("variant", value.variant)
        })
        .catch(() => {})
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
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

        for (const item of modelStore.recent) {
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

      const currentModel = createMemo(() => {
        const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
        if (sessionID) {
          const session = data.session.get(sessionID)
          const durable = session?.model
            ? { providerID: session.model.providerID, modelID: session.model.id }
            : undefined
          return sessionModelSelection(sessionID, modelStore.model, durable, undefined)
        }
        const a = agent.current()
        const fallback = getFirstValidModel(
          () => a && modelStore.model[agentModelKey(a.id)],
          () => a?.model && { providerID: a.model.providerID, modelID: a.model.id },
          fallbackModel,
        )
        return fallback
      })

      function scopeKey() {
        if (route.data.type === "session") return `session:${route.data.sessionID}`
        const current = agent.current()
        return current ? agentModelKey(current.id) : undefined
      }

      function agentModelKey(agentID: string) {
        const ref = location.ref ?? data.location.default()
        return `agent:${JSON.stringify([ref.directory, ref.workspaceID])}:${agentID}`
      }

      function select(model: ModelPreferenceModel) {
        const key = scopeKey()
        if (!key) return false
        if (key.startsWith("session:")) {
          const current = currentModel()
          const session = route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined
          const selected = modelStore.sessionVariant[key]
          const preferred = normalizeModelVariant(
            current?.providerID === model.providerID && current.modelID === model.modelID
              ? selected !== undefined
                ? (selected ?? undefined)
                : session?.model?.variant
              : modelStore.variant[modelPreferenceKey(model)],
          )
          const info = models()?.find((item) => item.providerID === model.providerID && item.id === model.modelID)
          const variant = preferred && info?.variants?.some((item) => item.id === preferred) ? preferred : null
          setModelStore("sessionVariant", key, variant)
        }
        setModelStore("model", key, model)
        return true
      }

      event.on("session.model.selected", (evt) => {
        const committed = commitKey({
          providerID: evt.data.model.providerID,
          modelID: evt.data.model.id,
          variant: normalizeModelVariant(evt.data.model.variant),
        })
        if (pendingCommits.get(evt.data.sessionID) !== committed) return
        pendingCommits.delete(evt.data.sessionID)
        const key = `session:${evt.data.sessionID}`
        const draft = modelStore.model[key]
        if (!draft) return
        if (draft.providerID !== evt.data.model.providerID || draft.modelID !== evt.data.model.id) return
        const variant = normalizeModelVariant(modelStore.sessionVariant[key] ?? undefined)
        if (variant !== normalizeModelVariant(evt.data.model.variant)) return
        setModelStore("model", key, undefined)
        setModelStore("sessionVariant", key, undefined)
      })

      event.on("session.deleted", (evt) => {
        pendingCommits.delete(evt.data.sessionID)
        const key = `session:${evt.data.sessionID}`
        setModelStore("model", key, undefined)
        setModelStore("sessionVariant", key, undefined)
      })

      return {
        current: currentModel,
        available(model = currentModel()) {
          return model ? isModelValid(model) : false
        },
        expectCommit(
          sessionID: string,
          value: ModelPreferenceModel & {
            variant?: string
          },
        ) {
          const committed = commitKey(value)
          pendingCommits.set(sessionID, committed)
          return () => {
            if (pendingCommits.get(sessionID) === committed) pendingCommits.delete(sessionID)
          }
        },
        get ready() {
          return modelStore.ready
        },
        get catalogReady() {
          return models() !== undefined
        },
        recent() {
          return modelStore.recent
        },
        favorite() {
          return modelStore.favorite
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
              available: false,
            }
          }
          const provider = providers()?.find((item) => item.id === value.providerID)
          const info = models()?.find((item) => item.providerID === value.providerID && item.id === value.modelID)
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? `${value.modelID} (unavailable)`,
            reasoning: (info?.variants?.length ?? 0) !== 0,
            available: info !== undefined,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentModel()
          if (!current) return
          const recent = recentModels(current, modelStore.recent).filter(isModelValid)
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          let next = index === -1 ? (direction === 1 ? 0 : recent.length - 1) : index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          select({ ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentModel()
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
          if (!select({ ...next })) return
          setModelStore("recent", recentModels(next, modelStore.recent))
          save()
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) return
            if (!select(model)) return
            if (options?.recent) {
              setModelStore("recent", recentModels(model, modelStore.recent))
              save()
            }
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) return
            const exists = modelStore.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            const next = exists
              ? modelStore.favorite.filter((x) => x.providerID !== model.providerID || x.modelID !== model.modelID)
              : [model, ...modelStore.favorite]
            setModelStore(
              "favorite",
              next.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
            )
            save()
          })
        },
        variant: {
          selected() {
            const m = currentModel()
            if (!m) return undefined
            const key = scopeKey()
            if (key?.startsWith("session:") && modelStore.sessionVariant[key] !== undefined)
              return normalizeModelVariant(modelStore.sessionVariant[key] ?? undefined)
            if (route.data.type === "session") {
              const durable = data.session.get(route.data.sessionID)?.model
              if (durable?.providerID === m.providerID && durable.id === m.modelID)
                return normalizeModelVariant(durable.variant)
            }
            return normalizeModelVariant(modelStore.variant[modelPreferenceKey(m)])
          },
          current() {
            const v = this.selected()
            if (v && this.list().includes(v)) return v
            return undefined
          },
          list() {
            const m = currentModel()
            if (!m) return []
            const info = models()?.find((item) => item.providerID === m.providerID && item.id === m.modelID)
            return info?.variants?.map((variant) => variant.id) ?? []
          },
          set(value: string | undefined) {
            const m = currentModel()
            if (!m) return
            const key = scopeKey()
            if (key?.startsWith("session:")) {
              setModelStore("model", key, { ...m })
              setModelStore("sessionVariant", key, normalizeModelVariant(value) ?? null)
              return
            }
            setModelStore("variant", modelPreferenceKey(m), normalizeModelVariant(value))
            save()
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
