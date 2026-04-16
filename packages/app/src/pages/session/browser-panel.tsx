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
import { done, fit, pipe, pull, push, type Hold } from "./browser-stream"

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

type Item = Omit<Tab, "sessionID">

type Group = {
  sessionID: string
  tabs: Item[]
}

type Tree = {
  sessionID: string
  tabs: Tab[]
}

type Shot = {
  src: string
  rev: number
  width?: number
  height?: number
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

  const list = (sessionID: string) => request(`/browser/${sessionID}/tabs/all`).then((res) => json(res) as Promise<Tree>)
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
    }).then((res) => json(res) as Promise<Group>)

  const viewport = (sessionID: string, width: number, height: number, scale: number) =>
    request(`/browser/${sessionID}/viewport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width, height, scale }),
    }).then((res) => json(res) as Promise<Status>)

  let box: HTMLDivElement | undefined
  let img: HTMLImageElement | undefined
  let timer: number | undefined
  let hard = false
  let hold: Hold | undefined
  let rev = 0
  let run = 0
  const slot = pipe<Shot>()

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
    const next = fit(hold, width, height, Date.now(), clear)
    hold = next.hold
    return next.ok
  }

  const wait = (img: HTMLImageElement) =>
    new Promise<void>((resolve, reject) => {
      if (img.complete) {
        if (img.naturalWidth > 0) {
          resolve()
          return
        }
        reject(new Error("Browser stream frame decode failed"))
        return
      }
      const done = () => {
        img.removeEventListener("load", done)
        img.removeEventListener("error", fail)
        resolve()
      }
      const fail = () => {
        img.removeEventListener("load", done)
        img.removeEventListener("error", fail)
        reject(new Error("Browser stream frame decode failed"))
      }
      img.addEventListener("load", done, { once: true })
      img.addEventListener("error", fail, { once: true })
    })

  const load = (img: HTMLImageElement) => (typeof img.decode === "function" ? img.decode().catch(() => wait(img)) : wait(img))

  const reset = () => {
    rev += 1
    run += 1
    slot.busy = false
    slot.next = undefined
    if (img) img.removeAttribute("src")
  }

  const show = (shot: Shot) => {
    const id = ++run
    const probe = new Image()
    probe.decoding = "async"
    probe.src = shot.src
    return load(probe)
      .then(() => {
        if (id !== run || shot.rev !== rev || !img) return
        if (!ok(shot.width, shot.height)) return
        img.src = shot.src
        setStore({
          loading: false,
          error: "",
          width: shot.width ?? store.width,
          height: shot.height ?? store.height,
        })
      })
      .catch(() => {
        if (id !== run || shot.rev !== rev) return
        if (store.width || store.height) return
        setStore({ loading: false, error: "Browser stream frame decode failed" })
      })
      .finally(() => {
        if (id !== run) return
        const next = done(slot)
        if (next) void show(next)
      })
  }

  const paint = (shot: Shot) => {
    push(slot, shot)
    const next = pull(slot)
    if (next) void show(next)
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

  const pack = (data: Group) => data.tabs.map((tab) => ({ ...tab, sessionID: data.sessionID }))

  const merge = (tabs: Tab[], data: Group) => {
    const next = pack(data)
    const out: Tab[] = []
    let seen = false
    for (const tab of tabs) {
      if (tab.sessionID !== data.sessionID) {
        out.push(tab)
        continue
      }
      if (seen) continue
      out.push(...next)
      seen = true
    }
    if (!seen) out.push(...next)
    return out
  }

  const apply = (tabs: Tab[], root: string) => {
    setStore("tabs", tabs)
    const next = pick(tabs.filter((tab) => !blank(tab)), store.view, root) ?? pick(tabs, store.view, root)
    if (!next) {
      setStore("view", { sessionID: "", index: -1 })
      return
    }
    const view = { sessionID: next.sessionID, index: next.index }
    if (same(store.view, view)) return
    setStore("view", view)
    aim()
    queueViewport(true)
  }

  const sync = (sessionID: string) =>
    list(sessionID)
      .then((data) => {
        apply(data.tabs, sessionID)
      })
      .catch(() => {})

  const patch = (root: string, data: Group) => apply(merge(store.tabs, data), root)

  const choose = (tab: Tab) => {
    const root = params.id
    if (!root) return
    const width = box ? Math.max(320, Math.floor(box.clientWidth)) : undefined
    const height = box ? Math.max(240, Math.floor(box.clientHeight)) : undefined
    const scale = dpr()
    aim()
    setStore("view", { sessionID: tab.sessionID, index: tab.index })
    void select({ sessionID: tab.sessionID, index: tab.index, width, height, scale })
      .then((data) => {
        patch(root, data)
        syncViewport(true)
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
    void sync(root)
  })

  createEffect(() => {
    const root = params.id
    if (!root || !opened()) return
    const stop = sdk.event.on("browser.updated", (evt) => {
      const sessionID = evt.properties.sessionID
      const tabs = evt.properties.tabs
      if (!tabs) return
      if (sessionID === root || store.tabs.some((tab) => tab.sessionID === sessionID)) {
        patch(root, tabs)
        return
      }
      void sync(root)
    })
    onCleanup(stop)
  })

  createEffect(() => {
    const sessionID = watch()
    if (!sessionID || !opened()) return

    let done = false
    let seen = false
    let fail = false
    let ws: WebSocket | undefined
    hold = undefined
    reset()

    setStore({
      loading: true,
      connected: false,
      screencasting: false,
      error: "",
      width: 0,
      height: 0,
    })

    const url = endpoint(`/browser/${sessionID}/stream/connect`)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const info = server.current?.http
    if (info?.password) {
      url.username = info.username ?? "opencode"
      url.password = info.password
    }

    ws = new WebSocket(url)

    ws.addEventListener("close", () => {
      if (done) return
      setStore({
        loading: false,
        connected: false,
        screencasting: false,
        ...(!seen && !fail ? { error: "Browser stream closed before startup" } : {}),
      })
    })

    ws.addEventListener("error", () => {
      if (done) return
      fail = true
      setStore({ loading: false, error: "Browser stream connection failed" })
    })

    ws.addEventListener("message", (event) => {
      if (done || typeof event.data !== "string") return
      const data = parse(event.data)
      if (!record(data)) return

      if (data.type === "error") {
        fail = true
        setStore({
          loading: false,
          connected: false,
          screencasting: false,
          error: text(data.error) ?? "Browser stream startup failed",
        })
        return
      }

      if (data.type === "ready") {
        seen = true
        setStore({ loading: false, error: "" })
        return
      }

      if (data.type === "frame") {
        const frame = text(data.data)
        if (!frame) return
        const meta = record(data.metadata) ? data.metadata : undefined
        const width = int(meta?.deviceWidth)
        const height = int(meta?.deviceHeight)
        if (!ok(width, height)) return
        seen = true
        paint({
          src: `data:image/jpeg;base64,${frame}`,
          rev,
          width,
          height,
        })
        return
      }

      if (data.type !== "status") return
      const width = int(data.viewportWidth)
      const height = int(data.viewportHeight)
      seen = true
      ok(width, height, false)
      setStore({
        loading: false,
        error: "",
        connected: bool(data.connected) ?? false,
        screencasting: bool(data.screencasting) ?? false,
      })
    })

    onCleanup(() => {
      done = true
      run += 1
      slot.busy = false
      slot.next = undefined
      if (ws && ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) ws.close()
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
            <img
              ref={img}
              alt="Agent browser stream"
              class="w-full h-full object-contain select-none"
              classList={{ hidden: !store.width || !store.height }}
              draggable={false}
            />
            <Show when={!store.width || !store.height}>
              <div class="absolute inset-0 flex items-center justify-center text-text-weak text-12-regular bg-background-base">
                <Show when={store.error} fallback={<span>{store.loading ? "Connecting browser stream..." : "No stream frame yet"}</span>}>
                  <span>{store.error}</span>
                </Show>
              </div>
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
