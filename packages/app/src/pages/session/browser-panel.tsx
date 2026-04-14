import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import type { Sizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"

type Status = {
  enabled: boolean
  port?: number
  connected?: boolean
  screencasting?: boolean
}

type Tab = {
  active: boolean
  index: number
  sessionID: string
  title: string
  type?: string
  url: string
}

type Tabs = {
  sessionID: string
  tabs: Tab[]
}

const parse = (raw: string) => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined)
const int = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined)
const host = (url: string) => (typeof URL !== "undefined" && URL.canParse(url) ? new URL(url).hostname : "")
const http = (value: string) => value.startsWith("http://") || value.startsWith("https://")
const name = (tab: Tab) => {
  const title = tab.title.trim()
  if (title && !http(title)) return title
  const url = host(tab.url)
  if (url) return url
  const text = host(title)
  if (text) return text
  if (title) return title
  return `Tab ${tab.index + 1}`
}

const eventSession = (value: unknown) => {
  if (!record(value)) return
  if (text(value.type) !== "browser.updated") return
  const props = record(value.properties) ? value.properties : undefined
  const info = record(props?.info) ? props.info : undefined
  return text(info?.sessionID)
}

const blank = (tab: Tab) => {
  const url = tab.url.trim().toLowerCase()
  if (url === "about:blank") return true
  const title = tab.title.trim().toLowerCase()
  return title === "about:blank"
}

const pick = (tabs: Tab[], view: { sessionID: string; index: number }, root?: string) => {
  const own = tabs.find((tab) => tab.sessionID === view.sessionID && tab.index === view.index)
  if (own) return own
  if (root) {
    const main = tabs.find((tab) => tab.sessionID === root && tab.active)
    if (main) return main
  }
  const live = tabs.find((tab) => tab.active)
  if (live) return live
  return tabs[0]
}

const same = (a: { sessionID: string; index: number }, b: { sessionID: string; index: number }) =>
  a.sessionID === b.sessionID && a.index === b.index

export function BrowserPanel(props: { size: Sizing }) {
  const layout = useLayout()
  const sdk = useSDK()
  const server = useServer()
  const { params, view } = useSessionLayout()
  const desktop = createMediaQuery("(min-width: 768px)")
  const [store, setStore] = createStore({
    frame: "",
    loading: false,
    connected: false,
    screencasting: false,
    error: "",
    width: 0,
    height: 0,
    tabs: [] as Tab[],
    sent: {
      sessionID: "",
      width: 0,
      height: 0,
      scale: 0,
    },
    view: {
      sessionID: "",
      index: -1,
    },
  })

  const opened = createMemo(() => view().browser.opened())
  const width = createMemo(() => layout.browser.width())
  const shown = createMemo(() => store.tabs.filter((tab) => !blank(tab)))
  const tab = createMemo(() => pick(shown(), store.view, params.id) ?? pick(store.tabs, store.view, params.id))
  const on = createMemo(() => pick(shown(), store.view, params.id))
  const url = createMemo(() => on()?.url ?? "")
  const watch = createMemo(() => tab()?.sessionID || params.id)
  const side = createMemo(() => {
    const max = typeof window === "undefined" ? 960 : Math.floor(window.innerWidth * 0.7)
    return Math.min(width(), max)
  })

  const auth = createMemo(() => {
    const info = server.current?.http
    if (!info?.password) return
    const user = info.username ?? "opencode"
    return `Basic ${btoa(`${user}:${info.password}`)}`
  })

  const endpoint = (path: string) => {
    const url = new URL(`${sdk.url}${path}`)
    url.searchParams.set("directory", sdk.directory)
    return url
  }

  const request = (path: string, init?: RequestInit) => {
    const url = endpoint(path)
    const headers = new Headers(init?.headers)
    const token = auth()
    if (token) headers.set("Authorization", token)
    return fetch(url, { ...init, headers })
  }

  const json = async (res: Response) => {
    if (res.ok) return res.json()
    const body = await res.text().catch(() => "")
    throw new Error(body || `${res.status} ${res.statusText}`)
  }

  const readStatus = (sessionID: string) => request(`/browser/${sessionID}/status`).then((res) => json(res) as Promise<Status>)
  const enable = (sessionID: string) =>
    request(`/browser/${sessionID}/stream/enable`, { method: "POST" }).then((res) => json(res) as Promise<Status>)

  const list = (sessionID: string) => request(`/browser/${sessionID}/tabs/all`).then((res) => json(res) as Promise<Tabs>)
  const select = (input: { sessionID: string; index: number; width?: number; height?: number; scale?: number }) =>
    request(`/browser/${input.sessionID}/tab/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        index: input.index,
        ...(input.width ? { width: input.width } : {}),
        ...(input.height ? { height: input.height } : {}),
        ...(input.scale ? { scale: input.scale } : {}),
      }),
    }).then((res) => json(res) as Promise<Tabs>)

  const disable = (sessionID: string) => request(`/browser/${sessionID}/stream/disable`, { method: "POST" })
  const viewport = (sessionID: string, width: number, height: number, scale: number) =>
    request(`/browser/${sessionID}/viewport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width, height, scale }),
    }).then((res) => json(res) as Promise<Status>)

  let box: HTMLDivElement | undefined
  let timer: number | undefined
  let hard = false
  let hold: { width: number; height: number; until: number } | undefined
  let pull: Promise<void> | undefined
  let ping = false

  const dpr = () => {
    if (typeof window === "undefined") return 1
    const value = Math.round(window.devicePixelRatio * 100) / 100
    if (!Number.isFinite(value)) return 1
    return Math.max(1, Math.min(3, value))
  }

  const aim = () => {
    if (!box) return
    hold = {
      width: Math.max(320, Math.floor(box.clientWidth)),
      height: Math.max(240, Math.floor(box.clientHeight)),
      until: Date.now() + 2500,
    }
  }

  const ok = (width?: number, height?: number, clear = true) => {
    const slot = hold
    if (!slot) return true
    if (Date.now() >= slot.until) {
      hold = undefined
      return true
    }
    if (!width || !height) return false
    const same = Math.abs(width - slot.width) <= 3 && Math.abs(height - slot.height) <= 3
    if (!same) return false
    if (clear) hold = undefined
    return true
  }

  const syncViewport = (force = false) => {
    const sessionID = watch()
    if (!sessionID || !opened() || !box) return
    const width = Math.max(320, Math.floor(box.clientWidth))
    const height = Math.max(240, Math.floor(box.clientHeight))
    const scale = dpr()
    if (
      !force &&
      store.sent.sessionID === sessionID &&
      store.sent.width === width &&
      store.sent.height === height &&
      store.sent.scale === scale
    ) {
      return
    }
    setStore("sent", { sessionID, width, height, scale })
    void viewport(sessionID, width, height, scale).catch(() => {})
  }

  const queueViewport = (force = false) => {
    if (force) hard = true
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      const next = hard
      hard = false
      timer = undefined
      syncViewport(next)
    }, 120)
  }

  const sync = (sessionID: string) =>
    list(sessionID)
      .then((data) => {
        setStore("tabs", data.tabs)
        const next = pick(data.tabs.filter((tab) => !blank(tab)), store.view, sessionID) ?? pick(data.tabs, store.view, sessionID)
        if (!next) return
        const view = { sessionID: next.sessionID, index: next.index }
        if (same(store.view, view)) return
        setStore("view", view)
        aim()
        queueViewport(true)
      })
      .catch(() => {})

  const refresh = (sessionID: string) => {
    if (pull) {
      ping = true
      return
    }
    pull = sync(sessionID).finally(() => {
      pull = undefined
      if (!ping) return
      ping = false
      refresh(sessionID)
    })
  }

  const choose = (tab: Tab) => {
    const root = params.id
    if (!root) return
    const width = box ? Math.max(320, Math.floor(box.clientWidth)) : undefined
    const height = box ? Math.max(240, Math.floor(box.clientHeight)) : undefined
    const scale = dpr()
    aim()
    setStore("view", { sessionID: tab.sessionID, index: tab.index })
    void select({ sessionID: tab.sessionID, index: tab.index, width, height, scale })
      .then(() => {
        syncViewport(true)
        void sync(root)
      })
      .catch(() => {})
  }

  createResizeObserver(
    () => box,
    () => {
      queueViewport()
    },
  )

  createEffect(() => {
    if (!opened() || !watch()) return
    queueViewport()
  })

  createEffect(() => {
    if (!desktop()) return
    const on = () => queueViewport()
    window.addEventListener("resize", on)
    onCleanup(() => {
      window.removeEventListener("resize", on)
    })
  })

  createEffect(() => {
    const root = params.id
    if (!root || !opened()) return

    let done = false
    const poll = () => {
      if (done) return
      refresh(root)
    }
    poll()
    const id = window.setInterval(poll, 1200)
    onCleanup(() => {
      done = true
      window.clearInterval(id)
    })
  })

  createEffect(() => {
    const root = params.id
    if (!root || !opened()) return
    const stop = sdk.event.listen((evt) => {
      const sessionID = eventSession(evt.details)
      if (!sessionID) return
      if (sessionID !== root && !store.tabs.some((tab) => tab.sessionID === sessionID)) return
      refresh(root)
    })
    onCleanup(stop)
  })

  createEffect(() => {
    const sessionID = watch()
    if (!sessionID || !opened()) return

    let done = false
    let ws: WebSocket | undefined
    hold = undefined

    setStore({
      frame: "",
      loading: true,
      connected: false,
      screencasting: false,
      error: "",
      width: 0,
      height: 0,
    })

    const open = async () => {
      const status = await readStatus(sessionID).catch(() => enable(sessionID)).catch((error: unknown) => {
        if (done) return
        const msg = error instanceof Error ? error.message : String(error)
        setStore({ loading: false, error: msg })
      })
      if (!status || done) return
      const next = status.enabled && int(status.port) ? status : await enable(sessionID).catch((error: unknown) => {
        if (done) return
        const msg = error instanceof Error ? error.message : String(error)
        setStore({ loading: false, error: msg })
      })
      if (!next || done) return
      const port = int(next.port)
      if (!port) {
        setStore({ loading: false, error: "No browser stream port available" })
        return
      }

      const url = endpoint(`/browser/${sessionID}/stream/connect`)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      const info = server.current?.http
      if (info?.password) {
        url.username = info.username ?? "opencode"
        url.password = info.password
      }

      ws = new WebSocket(url)

      ws.addEventListener("open", () => {
        if (done) return
        setStore({ loading: false, error: "" })
      })

      ws.addEventListener("close", () => {
        if (done) return
        setStore({ connected: false, screencasting: false })
      })

      ws.addEventListener("error", () => {
        if (done) return
        setStore({ loading: false, error: "Browser stream connection failed" })
      })

      ws.addEventListener("message", (event) => {
        if (done || typeof event.data !== "string") return
        const data = parse(event.data)
        if (!record(data)) return

        if (data.type === "frame") {
          const frame = text(data.data)
          if (!frame) return
          const meta = record(data.metadata) ? data.metadata : undefined
          const width = int(meta?.deviceWidth)
          const height = int(meta?.deviceHeight)
          if (!ok(width, height)) return
          setStore({
            frame,
            width: width ?? store.width,
            height: height ?? store.height,
          })
          return
        }

        if (data.type !== "status") return
        const width = int(data.viewportWidth)
        const height = int(data.viewportHeight)
        if (!ok(width, height, false) || hold) {
          setStore({
            connected: bool(data.connected) ?? store.connected,
            screencasting: bool(data.screencasting) ?? store.screencasting,
          })
          return
        }
        setStore({
          connected: bool(data.connected) ?? false,
          screencasting: bool(data.screencasting) ?? false,
          width: width ?? store.width,
          height: height ?? store.height,
        })
      })
    }

    void open()

    onCleanup(() => {
      done = true
      if (ws && ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) ws.close()
      void disable(sessionID)
    })
  })

  onCleanup(() => {
    if (timer !== undefined) window.clearTimeout(timer)
  })

  return (
    <Show when={desktop()}>
      <aside
        id="browser-panel"
        role="region"
        aria-label="Browser"
        aria-hidden={!opened()}
        inert={!opened()}
        class="relative min-w-0 h-full shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !opened(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active(),
        }}
        style={{ width: opened() ? `${side()}px` : "0px" }}
      >
        <div class="size-full flex flex-col border-l border-border-weaker-base">
          <div class="h-9 px-2 flex items-center gap-2 border-b border-border bg-surface-raised-base shrink-0">
            <div class="shrink-0 px-1 flex items-center gap-2 text-12-medium text-text-strong">
              <Icon name="window-cursor" size="small" />
              Browser
            </div>
            <div class="flex-1 min-w-0 h-full overflow-x-auto">
              <Show
                when={shown().length > 0}
                fallback={
                  <div class="h-full flex items-center px-1 text-11-regular text-text-weak">
                    No tabs
                  </div>
                }
              >
                <div class="h-full flex items-center gap-1 min-w-max pr-2">
                  <For each={shown()}>
                    {(tab) => (
                      <button
                        type="button"
                        class="h-7 px-2 rounded-md border text-11-regular min-w-0 max-w-[220px] transition-colors"
                        classList={{
                          "border-border-strong-base bg-surface-base text-text-strong":
                            same(on() ?? { sessionID: "", index: -1 }, { sessionID: tab.sessionID, index: tab.index }),
                          "border-border-base bg-surface-raised-base text-text-weak hover:text-text-strong hover:bg-surface-raised-base-hover":
                            !same(on() ?? { sessionID: "", index: -1 }, { sessionID: tab.sessionID, index: tab.index }),
                        }}
                        title={tab.url || tab.title || `Tab ${tab.index + 1}`}
                        onClick={() => choose(tab)}
                      >
                        <span class="truncate">{name(tab)}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="shrink-0 px-1 text-11-regular text-text-weak">
              <Show when={store.connected && store.screencasting} fallback={<span>Disconnected</span>}>
                <span>Streaming</span>
              </Show>
              <Show when={store.width > 0 && store.height > 0}>
                <span>{` · ${store.width}x${store.height}`}</span>
              </Show>
            </div>
          </div>
          <div class="h-9 px-2 flex items-center gap-2 border-b border-border bg-surface-base shrink-0">
            <div class="shrink-0 px-1 text-11-regular text-text-weak">URL</div>
            <input
              value={url()}
              readOnly
              spellcheck={false}
              class="h-7 flex-1 min-w-0 rounded-md border border-border-base bg-surface-raised-base px-2 text-11-regular text-text-strong outline-none"
              placeholder="No selected tab URL"
              title={url() || "No selected tab URL"}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>

          <div ref={box} class="flex-1 min-h-0 bg-black relative overflow-hidden">
            <Show
              when={store.frame}
              fallback={
                <div class="absolute inset-0 flex items-center justify-center text-text-weak text-12-regular bg-background-base">
                  <Show
                    when={store.error}
                    fallback={<span>{store.loading ? "Connecting browser stream..." : "No stream frame yet"}</span>}
                  >
                    <span>{store.error}</span>
                  </Show>
                </div>
              }
            >
              {(frame) => (
                <img
                  src={`data:image/jpeg;base64,${frame()}`}
                  alt="Agent browser stream"
                  class="w-full h-full object-contain select-none"
                  draggable={false}
                />
              )}
            </Show>
          </div>
        </div>
        <Show when={opened()}>
          <div onPointerDown={() => props.size.start()}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={side()}
              min={360}
              max={typeof window === "undefined" ? 960 : window.innerWidth * 0.7}
              collapseThreshold={280}
              onResize={(next) => {
                props.size.touch()
                layout.browser.resize(next)
              }}
              onCollapse={() => view().browser.close()}
            />
          </div>
        </Show>
      </aside>
    </Show>
  )
}
