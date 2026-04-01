import type { Message, Part, ProviderListResponse, Session } from "@opencode-ai/sdk/v2/client"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { Binary } from "@opencode-ai/util/binary"
import { useParams } from "@solidjs/router"
import { batch, createEffect, createMemo, For, Show } from "solid-js"
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"
import { useCommand } from "@/context/command"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import type { State } from "@/context/global-sync/types"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { decode64 } from "@/utils/base64"
import { Identifier } from "@/utils/id"
import { Persist, persisted } from "@/utils/persist"
import { working } from "@/pages/session/session-working"
import { formatServerError } from "@/utils/server-errors"
import { mergeMessages, render } from "./quick-assistant-helpers"

function errorName(err: unknown) {
  if (!err || typeof err !== "object") return undefined
  const value = err as { name?: unknown }
  return typeof value.name === "string" ? value.name : undefined
}

type Pick = {
  agent: string
  model: {
    providerID: string
    modelID: string
  }
}

type AgentPick = State["agent"][number]
const QUICK_AGENT = "assistant"

type Saved = {
  open: boolean
  session: Record<string, string | undefined>
}

const initial = {
  open: false,
  session: {},
} satisfies Saved

function validModel(store: State, model: { providerID: string; modelID: string } | undefined) {
  if (!model) return true
  const provider = store.provider.all.find((item) => item.id === model.providerID)
  if (!provider) return false
  if (!store.provider.connected.includes(model.providerID)) return false
  return !!provider.models[model.modelID]
}

function pickAgent(store: State) {
  const all = store.agent.filter((item) => item.mode !== "subagent")
  const quick = all.find((item) => item.name === QUICK_AGENT)
  if (quick && validModel(store, quick.model)) return quick
  const list = all.filter((item) => !item.hidden)
  if (list.length === 0) return
  const preferred = list.find((item) => item.name === store.config.default_agent)
  if (preferred && validModel(store, preferred.model)) return preferred
  return list.find((item) => validModel(store, item.model)) ?? preferred ?? list[0]
}

function choose(store: State, preferredModel: { providerID: string; modelID: string } | undefined, openclaw: boolean) {
  if (openclaw) {
    return {
      agent: "claw",
      model: {
        providerID: "openclaw",
        modelID: "claw",
      },
    } satisfies Pick
  }

  const item = pickAgent(store)
  const agent = item?.name
  if (!agent || !validModel(store, item?.model)) return

  if (preferredModel && validModel(store, preferredModel)) {
    return {
      agent,
      model: preferredModel,
    } satisfies Pick
  }

  const connected = new Set(store.provider.connected)
  const configured = store.config.model?.split("/")
  if (configured?.length === 2) {
    const [providerID, modelID] = configured
    const provider = store.provider.all.find((item) => item.id === providerID)
    if (provider?.models[modelID] && connected.has(providerID)) {
      return {
        agent,
        model: { providerID, modelID },
      } satisfies Pick
    }
  }

  const model = pickModel(store.provider, connected)
  if (!model) return
  return {
    agent,
    model,
  } satisfies Pick
}

function pickModel(provider: ProviderListResponse, connected: Set<string>) {
  for (const item of provider.all) {
    if (!connected.has(item.id)) continue
    const preferred = provider.default[item.id]
    if (preferred && item.models[preferred]) {
      return {
        providerID: item.id,
        modelID: preferred,
      }
    }
    const first = Object.values(item.models)[0]
    if (!first) continue
    return {
      providerID: item.id,
      modelID: first.id,
    }
  }
}

function seed(setStore: SetStoreFunction<State>, session: Session) {
  setStore("session", (list: Session[]) => {
    const result = Binary.search(list, session.id, (item) => item.id)
    const next = [...list]
    if (result.found) {
      next[result.index] = session
      return next
    }
    next.splice(result.index, 0, session)
    return next
  })
}

function patchSession(setStore: SetStoreFunction<State>, sessionID: string, next: Partial<Session>) {
  setStore("session", (list: Session[]) => {
    const result = Binary.search(list, sessionID, (item) => item.id)
    if (!result.found) return list
    const copy = [...list]
    copy[result.index] = {
      ...copy[result.index],
      ...next,
    }
    return copy
  })
}

function notFound(err: unknown) {
  if (errorName(err) === "NotFoundError") return true
  if (!err || typeof err !== "object") return false
  const data = "data" in err ? (err as { data?: unknown }).data : undefined
  if (!data || typeof data !== "object") return false
  const name = "name" in data ? (data as { name?: unknown }).name : undefined
  return name === "NotFoundError"
}

function join(root: string, child: string) {
  return root.replace(/[\\/]+$/, "") + "/" + child
}

function clip(text: string, limit: number) {
  if (text.length <= limit) return text
  return text.slice(0, limit - 1).trimEnd() + "..."
}

export function QuickAssistant() {
  const params = useParams()
  const command = useCommand()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const server = useServer()
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  if (platform.platform !== "desktop") return null
  const [saved, setSaved] = persisted(
    Persist.global("quick-assistant", ["quick-assistant.v1"]),
    createStore<Saved>(initial),
  )
  const [state, setState] = createStore({
    text: "",
    loading: false,
  })
  let input!: HTMLTextAreaElement
  const win = createMemo(() => platform.os === "windows")

  const dir = createMemo(() => decode64(params.dir) ?? "")
  const root = createMemo(() => {
    const base = globalSync.data.path.config
    if (!base) return ""
    return join(base, "quick-assistant")
  })
  const activeDir = createMemo(() => {
    const current = dir()
    if (!current) return ""
    if (current === root()) return ""
    return current
  })
  const openclaw = createMemo(() => server.current?.integration === "openclaw")
  const child = createMemo(() => {
    const next = root()
    if (!next) return
    return globalSync.child(next)
  })
  const data = createMemo(() => child()?.[0])
  const setData = createMemo(() => child()?.[1])
  const key = () => "__quick__"
  const sessionID = createMemo(() => saved.session[key()])
  const list = createMemo(() => {
    const id = sessionID()
    if (!id) return [] as Message[]
    return data()?.message[id] ?? []
  })
  const busy = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return working(data()?.session_status[id], list())
  })
  const chosen = createMemo(() => {
    const store = data()
    if (!store) return
    return choose(store, settings.assistant.model(), openclaw())
  })
  const currentChild = createMemo(() => {
    const current = activeDir()
    if (!current) return
    return globalSync.child(current, { bootstrap: false })
  })
  const currentData = createMemo(() => currentChild()?.[0])
  const currentSession = createMemo(() => {
    const id = params.id
    if (!id) return
    return currentData()?.session.find((item) => item.id === id)
  })
  const currentMessages = createMemo(() => {
    const id = params.id
    if (!id) return [] as Message[]
    return currentData()?.message[id] ?? []
  })
  const currentContext = createMemo(() => {
    const current = activeDir()
    const id = params.id
    if (!current || !id) return ""
    const session = currentSession()
    const messages = currentMessages()
    const recent = messages
      .slice(-8)
      .map((item) => {
        const text = clip(
          render(currentData()?.part[item.id]) || (item.role === "assistant" ? "[no text parts]" : ""),
          500,
        )
        if (!text) return undefined
        return `${item.role}: ${text}`
      })
      .filter((item): item is string => !!item)

    return [
      "<current-opencode-session>",
      `directory: ${current}`,
      `session_id: ${id}`,
      `title: ${session?.title || "Untitled"}`,
      `message_count: ${messages.length}`,
      ...(recent.length > 0
        ? ["recent_messages:", ...recent.map((item) => `- ${item}`)]
        : ["recent_messages: unavailable"]),
      "</current-opencode-session>",
    ].join("\n")
  })

  createEffect(() => {
    const next = root()
    if (!next) return
    if (platform.platform !== "desktop") return
    if (!platform.readConfigFile || !platform.writeConfigFile) return
    const file = join(next, "opencode.json")
    platform.readConfigFile(file).then((existing) => {
      if (existing !== null) return
      return platform.writeConfigFile!(
        file,
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            instructions: [],
            plugin: [],
            skills: {
              paths: [],
              urls: [],
            },
          },
          null,
          2,
        ),
      )
    })
  })

  const clearSession = () => {
    const id = sessionID()
    if (!id) return
    const setStore = setData()
    setSaved("session", key(), undefined)
    if (!setStore) return
    batch(() => {
      setStore("session_status", (items) => {
        if (!(id in items)) return items
        const next = { ...items }
        delete next[id]
        return next
      })
      setStore("message", (items) => {
        if (!(id in items)) return items
        const next = { ...items }
        delete next[id]
        return next
      })
    })
  }

  const ensureSession = async (
    client: ReturnType<typeof globalSDK.createClient>,
    setStore: SetStoreFunction<State>,
  ) => {
    const current = sessionID()
    if (current) {
      const existing = await client.session
        .get({ sessionID: current })
        .then((result) => result.data)
        .catch((err: unknown) => {
          if (!notFound(err)) throw err
          clearSession()
          return undefined
        })
      if (existing) return existing.id
    }

    const created = await client.session.create().then((result) => result.data ?? undefined)
    if (!created) return
    seed(setStore, created)
    patchSession(setStore, created.id, { title: "Quick Assistant" })
    setSaved("session", key(), created.id)
    void client.session.update({ sessionID: created.id, title: "Quick Assistant" }).catch(() => {})
    return created.id
  }

  const toggle = () => {
    setSaved("open", !saved.open)
  }

  const reset = async () => {
    const current = root()
    const id = sessionID()
    const setStore = setData()
    if (current && id && busy()) {
      await globalSDK
        .createClient({ directory: current, throwOnError: true })
        .session.abort({ sessionID: id })
        .catch((err: unknown) => {
          showToast({
            title: "Quick Assistant",
            description: formatServerError(err, language.t, language.t("common.requestFailed")),
          })
        })
      if (setStore) setStore("session_status", id, { type: "idle" })
    }
    clearSession()
    setState("loading", false)
    setState("text", "")
  }

  command.register("quick-assistant", () => [
    {
      id: "assistant.quick.toggle",
      title: "Quick Assistant",
      description: "Open the floating project helper",
      category: language.t("command.category.session"),
      keybind: "mod+shift+j",
      onSelect: toggle,
    },
  ])

  createEffect(() => {
    if (!saved.open) return
    queueMicrotask(() => input?.focus())
  })

  createEffect(() => {
    const current = root()
    const id = sessionID()
    const store = data()
    const setStore = setData()
    if (!current || !id || !store || !setStore) return
    if (store.message[id] !== undefined) return
    const client = globalSDK.createClient({ directory: current, throwOnError: true })
    client.session
      .messages({ sessionID: id, limit: 80 })
      .then((result) => {
        const items = (result.data ?? []).filter((item) => !!item?.info?.id)
        const message = items.map((item) => item.info).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const local = store.message[id] ?? []
        const next = mergeMessages(local, message)
        if (local.length > 0 && next.length > message.length) {
          console.debug("[quick-assistant] preserved optimistic messages during history sync", {
            sessionID: id,
            local: local.length,
            fetched: message.length,
            merged: next.length,
          })
        }
        batch(() => {
          setStore("message", id, reconcile(next, { key: "id" }))
          for (const item of items) {
            setStore("part", item.info.id, item.parts)
          }
        })
      })
      .catch((err: unknown) => {
        if (notFound(err)) {
          clearSession()
          return
        }
      })
  })

  createEffect(() => {
    const current = root()
    const id = sessionID()
    const setStore = setData()
    if (!current || !id || !setStore) return

    const off = globalSDK.event.listen((e) => {
      if (e.name !== current) return
      const event = e.details
      if (event.type === "session.status") {
        if (event.properties.sessionID !== id) return
        setStore("session_status", id, event.properties.status)
        return
      }

      if (event.type === "session.idle") {
        if (event.properties.sessionID !== id) return
        setStore("session_status", id, { type: "idle" })
        setState("loading", false)
        return
      }

      if (event.type !== "session.error") return
      if (event.properties.sessionID !== id) return
      setStore("session_status", id, { type: "idle" })
      setState("loading", false)
      showToast({
        title: "Quick Assistant",
        description: formatServerError(event.properties.error, language.t, language.t("common.requestFailed")),
      })
    })

    return off
  })

  async function submit() {
    const current = root()
    const text = state.text.trim()
    const store = data()
    const setStore = setData()
    if (!current) {
      showToast({
        title: "Quick Assistant",
        description: "Quick Assistant is still starting.",
      })
      return
    }
    if (!text) return
    if (!store || !setStore) return
    const body = [currentContext(), text].filter(Boolean).join("\n\n")
    const pick = chosen()
    if (!pick) {
      showToast({
        title: "Quick Assistant",
        description: "Connect a model provider first.",
      })
      return
    }

    setState("loading", true)
    const client = globalSDK.createClient({ directory: current, throwOnError: true })
    const id = await ensureSession(client, setStore).catch((err: unknown) => {
      showToast({
        title: "Quick Assistant",
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
      return undefined
    })

    if (!id) {
      setState("loading", false)
      return
    }

    const messageID = Identifier.ascending("message")
    const now = Date.now()
    const msg: Message = {
      id: messageID,
      sessionID: id,
      role: "user",
      time: { created: now },
      agent: pick.agent,
      model: pick.model,
    }
    const part: Part = {
      id: Identifier.ascending("part"),
      type: "text",
      text: body,
      sessionID: id,
      messageID,
    }

    batch(() => {
      setStore("session_status", id, { type: "busy" })
      setStore("message", (items) => {
        const list = items[id] ?? []
        const result = Binary.search(list, msg.id, (item) => item.id)
        const next = [...list]
        next.splice(result.index, 0, msg)
        return {
          ...items,
          [id]: next,
        }
      })
      setStore("part", messageID, [part])
      setState("text", "")
      setSaved("open", true)
    })

    await client.session
      .promptAsync({
        sessionID: id,
        agent: pick.agent,
        model: pick.model,
        messageID,
        parts: [
          {
            id: part.id,
            type: "text",
            text: body,
          },
        ],
      })
      .catch((err: unknown) => {
        batch(() => {
          setStore("session_status", id, { type: "idle" })
          setStore("message", (items) => {
            const list = items[id] ?? []
            const result = Binary.search(list, messageID, (item) => item.id)
            if (!result.found) return items
            const next = [...list]
            next.splice(result.index, 1)
            return {
              ...items,
              [id]: next,
            }
          })
          setStore("part", (items: Record<string, Part[] | undefined>) => {
            if (!(messageID in items)) return items
            const next = { ...items }
            delete next[messageID]
            return next
          })
        })
        showToast({
          title: "Quick Assistant",
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
      })

    if (!busy()) setState("loading", false)
  }

  const dock = createMemo(() => !!sessionID() || busy())

  return (
    <>
      <Show when={!saved.open && dock()}>
        <button
          type="button"
          class="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full border border-border-weak-base px-3 py-2 shadow-[var(--shadow-lg-border-base)]"
          classList={{
            "bg-background-stronger/92 backdrop-blur-xl": !win(),
            "bg-surface-raised-stronger-non-alpha": win(),
          }}
          onClick={() => setSaved("open", true)}
        >
          <Icon name="bubble-5" class="size-4 text-icon-base" />
          <span class="text-12-medium text-text-strong">Assistant</span>
          <Show when={busy()}>
            <span class="size-2 rounded-full bg-success-base animate-pulse" />
          </Show>
        </button>
      </Show>

      <Show when={saved.open}>
        <div
          class="fixed right-5 bottom-5 z-40 w-[min(520px,calc(100vw-24px))] rounded-[24px] shadow-[var(--shadow-lg-border-base)]"
          classList={{
            "bg-background-stronger/92 backdrop-blur-2xl": !win(),
            "bg-surface-raised-stronger-non-alpha": win(),
          }}
        >
          <div class="flex flex-col gap-3 p-3">
            <div class="flex items-end gap-3 rounded-[24px] border border-border-weak-base bg-surface-panel px-3 py-3">
              <textarea
                ref={input}
                rows={3}
                value={state.text}
                placeholder="Ask about the current OpenCode session or a quick task..."
                class="min-h-18 flex-1 resize-none bg-transparent text-14-regular text-text-strong outline-none placeholder:text-text-weaker"
                onInput={(event) => setState("text", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return
                  event.preventDefault()
                  if (busy()) {
                    void reset()
                    return
                  }
                  void submit()
                }}
              />
              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class="flex size-10 items-center justify-center rounded-full border border-border-weak-base bg-background-base text-text-strong shadow-xs-border"
                  onClick={() => void reset()}
                  aria-label={sessionID() || list().length > 0 ? "Clear assistant" : "New assistant"}
                  title={sessionID() || list().length > 0 ? "Clear" : "New"}
                >
                  <Icon name="new-session" class="size-4.5" />
                </button>
                <button
                  type="button"
                  class="flex size-10 items-center justify-center rounded-full bg-text-strong text-background-base shadow-xs-border disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!busy() && (state.loading || !root() || !state.text.trim())}
                  onClick={() => {
                    if (busy()) {
                      void reset()
                      return
                    }
                    void submit()
                  }}
                  aria-label={busy() ? "Stop" : "Send"}
                  title={busy() ? "Stop" : "Send"}
                >
                  <Icon name={busy() ? "stop" : "arrow-up-bold"} class={busy() ? "size-3.5" : "size-4.5"} />
                </button>
              </div>
            </div>

            <Show when={list().length > 0}>
              <div class="max-h-[48vh] overflow-y-auto rounded-[24px] border border-border-weak-base bg-background-base/70 px-3 py-3">
                <div class="flex flex-col gap-3">
                  <For each={list()}>
                    {(item) => {
                      const text = createMemo(() => render(data()?.part[item.id]))
                      return (
                        <div
                          classList={{
                            "rounded-2xl px-3 py-2": true,
                            "ml-10 bg-surface-panel": item.role === "user",
                            "mr-10 border border-border-weaker-base bg-background-stronger": item.role === "assistant",
                          }}
                        >
                          <div class="whitespace-pre-wrap break-words text-13-regular text-text-base">
                            {text() || (item.role === "assistant" && busy() ? "Thinking..." : "")}
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </>
  )
}
