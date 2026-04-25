import type { Message, Part, ProviderListResponse, Session } from "@opencode-ai/sdk/v2/client"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Markdown } from "@opencode-ai/ui/markdown"
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
import { domainFromDirectory, extraAgentCapabilities, type ExtraAgentCapabilities } from "@/pages/layout/extra-agents"
import { context, mergeMessages, prompt, render } from "./quick-assistant-helpers"

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
  context: boolean
}

const initial = {
  open: false,
  session: {},
  context: false,
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

function choose(
  store: State,
  preferredModel: { providerID: string; modelID: string } | undefined,
  override?: ExtraAgentCapabilities["agentChoose"],
) {
  if (override) {
    return {
      agent: override.agent,
      model: override.model,
    } satisfies Pick
  }

  const item = pickAgent(store)
  const agent = item?.name
  if (!agent) return

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
  const slash = /^[A-Za-z]:\\|\\\\/.test(root) || root.includes("\\") ? "\\" : "/"
  return root.replace(/[\\/]+$/, "") + slash + child
}

function native(dir: string, win: boolean) {
  if (!dir) return dir
  return win ? dir.replace(/\//g, "\\") : dir.replace(/\\/g, "/")
}

function same(a: string, b: string, win: boolean) {
  if (win) return native(a, true).toLowerCase() === native(b, true).toLowerCase()
  return native(a, false) === native(b, false)
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

  const dir = createMemo(() => native(decode64(params.dir) ?? "", win()))
  const root = createMemo(() => {
    const base = globalSync.data.path.config
    if (!base) return ""
    return native(join(base, "quick-assistant"), win())
  })
  const activeDir = createMemo(() => {
    const current = dir()
    if (!current) return ""
    if (same(current, root(), win())) return ""
    return current
  })
  const agentChoose = createMemo(() => extraAgentCapabilities(server.current?.integration)?.agentChoose)
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
  const enabled = createMemo(() => settings.assistant.model() !== "disabled")
  const chosen = createMemo(() => {
    const store = data()
    const model = settings.assistant.model()
    if (!store || model === "disabled") return
    return choose(store, model, agentChoose())
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

  const currentContext = createMemo(() => {
    const current = activeDir()
    const id = params.id
    if (!current || !id) return ""
    const session = currentSession()
    const messages = currentData()?.message[id] ?? []
    return context(current, id, session, messages.length)
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

  const toggleContext = () => {
    const next = !saved.context
    console.debug(`[quick-assistant] context ${next ? "enabled" : "disabled"}`)
    setSaved("context", next)
  }

  const reset = async () => {
    const current = root()
    const id = sessionID()
    const setStore = setData()
    console.debug(
      `[quick-assistant] reset busy=${busy() ? 1 : 0} session=${id ?? ""} messages=${list().length} context=${saved.context ? 1 : 0}`,
    )
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
      disabled: !enabled(),
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

    const off = globalSDK.eventFor(domainFromDirectory(current)).listen((e) => {
      if (!same(e.name, current, win())) return
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
    const body = prompt(text, currentContext(), saved.context)
    const pick = chosen()
    if (!pick) {
      showToast({
        title: "Quick Assistant",
        description: "Connect a model provider first.",
      })
      return
    }

    setState("loading", true)
    console.debug(
      `[quick-assistant] submit context=${saved.context ? 1 : 0} text=${text.length} body=${body.length}`,
    )
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
        const aborted = errorName(err) === "AbortError"
        batch(() => {
          setStore("session_status", id, { type: "idle" })
          if (aborted) {
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
          }
        })
        showToast({
          title: "Quick Assistant",
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
      })

    if (!busy()) setState("loading", false)
  }

  const dock = createMemo(() => enabled() && !!activeDir())

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
          class="fixed right-5 bottom-5 z-40 w-[min(520px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border-weak-base shadow-[var(--shadow-lg-border-base)]"
          classList={{
            "bg-background-stronger/70 backdrop-blur-xl": !win(),
            "bg-background-stronger": win(),
          }}
          style={{
            "backdrop-filter": win() ? "none" : "blur(40px) saturate(150%)",
            "-webkit-backdrop-filter": win() ? "none" : "blur(40px) saturate(150%)",
          }}
        >
          <div class="flex flex-col">
            <div class="flex items-end gap-3 px-4 py-4">
              <textarea
                ref={input}
                rows={3}
                value={state.text}
                placeholder="Ask about the current OpenCode session or a quick task..."
                class="min-h-18 flex-1 resize-none bg-transparent text-14-regular text-text-strong outline-none placeholder:text-text-weaker"
                onInput={(event) => setState("text", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setSaved("open", false)
                    return
                  }
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
                  class="flex size-10 items-center justify-center rounded-full border border-border-weak-base bg-background-base text-text-strong shadow-xs-border transition-colors hover:border-border-strong-base hover:bg-surface-base-hover active:bg-surface-base-active"
                  onClick={() => void reset()}
                  aria-label={sessionID() || list().length > 0 ? "Clear assistant" : "New assistant"}
                  title={sessionID() || list().length > 0 ? "Clear" : "New"}
                >
                  <Icon name="new-session" class="size-4.5" />
                </button>
                <button
                  type="button"
                  class="flex size-10 items-center justify-center rounded-full border border-border-weak-base bg-background-base text-text-strong shadow-xs-border transition-colors"
                  classList={{
                    "border-border-success-base bg-surface-success-base text-text-on-success-base hover:border-border-success-hover active:border-border-success-selected":
                      saved.context,
                    "text-text-weaker hover:border-border-strong-base hover:bg-surface-base-hover hover:text-text-strong active:bg-surface-base-active":
                      !saved.context,
                  }}
                  onClick={toggleContext}
                  aria-pressed={saved.context}
                  aria-label={saved.context ? "Disable current session context" : "Enable current session context"}
                  title={saved.context ? "Current session context on" : "Current session context off"}
                >
                  <Icon name="link" class="size-4.5" />
                </button>
                <IconButton
                  type="button"
                  icon={busy() ? "stop" : "arrow-up-bold"}
                  variant="primary"
                  iconSize={busy() ? "normal" : "medium"}
                  class="size-10 rounded-full shadow-xs-border disabled:cursor-not-allowed disabled:opacity-50"
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
                />
              </div>
            </div>

            <Show when={list().length > 0}>
              <div class="max-h-[48vh] overflow-y-auto border-t border-border-weak-base bg-background-base/20 px-4 py-4">
                <div class="flex flex-col gap-3">
                  <For each={list()}>
                    {(item) => {
                      const text = createMemo(() => render(data()?.part[item.id]))
                      return (
                        <div
                          data-component="quick-assistant-message"
                          data-role={item.role}
                          classList={{
                            "px-3.5 py-3": true,
                            "ml-10 rounded-[18px] border border-border-weak-base bg-surface-panel":
                              item.role === "user",
                            "mr-10 rounded-[20px] border border-border-weaker-base bg-background-stronger":
                              item.role === "assistant",
                          }}
                        >
                          <Show
                            when={item.role === "assistant"}
                            fallback={
                              <div class="whitespace-pre-wrap break-words text-[15px] leading-7 text-text-strong">
                                {text()}
                              </div>
                            }
                          >
                            <div class="quick-assistant-markdown text-[15px] leading-7 text-text-base">
                              <Markdown text={text() || (busy() ? "Thinking..." : "")} math="defer" />
                            </div>
                          </Show>
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
