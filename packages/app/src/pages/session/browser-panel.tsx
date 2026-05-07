import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import type { Sizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { bytes, keyData, mapPoint, mods, mouseButton, pageUrl } from "./browser-input"
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
  data: string
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
const site = (url: string) => host(url).replace(/^www\./, "")
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
const equal = (a: Tab, b: Tab) =>
  a.sessionID === b.sessionID &&
  a.index === b.index &&
  a.active === b.active &&
  a.title === b.title &&
  a.type === b.type &&
  a.url === b.url
const tabid = (tab: { sessionID: string; index: number }) => `${tab.sessionID}:${tab.index}`
const key = (tab: { sessionID: string; index: number }) => `browser:${tabid(tab)}`
const fav = (url: string) => (http(url) && typeof URL !== "undefined" && URL.canParse(url) ? new URL("/favicon.ico", url).toString() : "")
const glyph = (tab: Tab) => {
  const value = site(tab.url) || name(tab)
  const match = value.trim().match(/[a-z0-9]/i)?.[0]
  if (match) return match.toUpperCase()
  return "•"
}
const sessions = (tabs: Tab[], root?: string) => {
  const out = tabs.reduce<string[]>((acc, tab) => (acc.includes(tab.sessionID) ? acc : [...acc, tab.sessionID]), [])
  if (!root || !out.includes(root)) return out
  return [root, ...out.filter((id) => id !== root)]
}
const mark = (ids: string[], tab: Tab, root: string | undefined, title: (id: string) => string | undefined) => {
  if (ids.length < 2) return ""
  if (root && tab.sessionID === root) return "Main"
  const at = ids.indexOf(tab.sessionID)
  if (at === -1) return ""
  const text = title(tab.sessionID)?.trim()
  if (text) return text
  return `S${at + 1}`
}

export function BrowserPanel(props: { size: Sizing }) {
  const layout = useLayout()
  const sdk = useSDK()
  const server = useServer()
  const sync = useSync()
  const { params, view } = useSessionLayout()
  const desktop = createMediaQuery("(min-width: 768px)")
  const [store, setStore] = createStore({
    loading: false,
    connected: false,
    screencasting: false,
    error: "",
    addr: "",
    edit: false,
    focus: false,
    take: "",
    reveal: "",
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
  const cur = createMemo(() => {
    const value = on()
    if (!value) return
    return key(value)
  })
  const taken = (tab: { sessionID: string; index: number }) => layout.takeover.has(tabid(tab))
  const status = (sessionID: string) => sync.data.session_status[sessionID] ?? ({ type: "idle" as const })
  const active = createMemo(() => {
    const value = on()
    if (!value) return false
    return layout.takeover.current() === tabid(value)
  })
  const paused = createMemo(() => {
    const value = on()
    if (!value) return false
    return status(value.sessionID).type === "paused"
  })
  const ids = createMemo(() => sessions(shown(), params.id))
  const title = (id: string) => sync.data.session.find((item) => item.id === id)?.title
  const watch = createMemo(() => tab()?.sessionID)
  const side = createMemo(() => {
    const max = typeof window === "undefined" ? 960 : Math.floor(window.innerWidth * 0.7)
    return Math.min(width(), max)
  })
  const live = createMemo(() => store.connected && store.screencasting)
  const ready = createMemo(() => active() && paused() && live())
  const action = createMemo(() => {
    const value = on()
    if (value && (taken(value) || status(value.sessionID).type === "paused")) {
      return { type: "resume" as const, tab: value }
    }
    if (value && store.reveal === tabid(value)) return { type: "take" as const, tab: value }
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

  const sock = (path: string) => {
    const url = endpoint(path)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const info = server.current?.http
    if (info?.password) {
      url.username = info.username ?? "opencode"
      url.password = info.password
    }
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
  const nav = (sessionID: string, url: string) =>
    request(`/browser/${sessionID}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((res) => json(res) as Promise<Status>)
  const act = (sessionID: string, cmd: "back" | "forward" | "reload") =>
    request(`/browser/${sessionID}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: cmd }),
    }).then((res) => json(res) as Promise<Status>)

  let box: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let timer: number | undefined
  let hard = false
  let hold: Hold | undefined
  let rev = 0
  let run = 0
  let ws: WebSocket | undefined
  const slot = pipe<Shot>()

  const dpr = () => {
    if (typeof window === "undefined") return 1
    const value = Math.round(window.devicePixelRatio * 100) / 100
    if (!Number.isFinite(value)) return 1
    return Math.max(1, Math.min(3, value))
  }

  const wait = () => {
    if (typeof document === "undefined") return 300
    if (document.visibilityState === "visible" && document.hasFocus()) return 300
    return 10_000
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

  const reset = () => {
    rev += 1
    run += 1
    slot.busy = false
    slot.next = undefined
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
    canvas.width = 0
    canvas.height = 0
  }

  const align = (w?: number, h?: number) => {
    if (!w || !h || !opened() || !box || !live()) return true
    const width = Math.max(320, Math.floor(box.clientWidth))
    const height = Math.max(240, Math.floor(box.clientHeight))
    if (Math.abs(w - width) <= 3 && Math.abs(h - height) <= 3) return true
    queueViewport(true)
    return false
  }

  const show = (shot: Shot) => {
    const id = ++run
    let bmp: ImageBitmap | undefined
    return createImageBitmap(new Blob([bytes(shot.data)], { type: "image/jpeg" }))
      .then((next) => {
        bmp = next
        if (id !== run || shot.rev !== rev || !canvas) return
        const width = shot.width ?? next.width
        const height = shot.height ?? next.height
        if (!ok(width, height)) return
        if (!align(width, height)) return
        canvas.width = next.width
        canvas.height = next.height
        const ctx = canvas.getContext("2d")
        ctx?.drawImage(next, 0, 0)
        setStore({
          loading: false,
          error: "",
          width,
          height,
        })
      })
      .catch(() => {
        if (id !== run || shot.rev !== rev) return
        if (store.width || store.height) return
        setStore({ loading: false, error: "Browser stream frame decode failed" })
      })
      .finally(() => {
        bmp?.close()
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
    if (!sessionID || !opened() || !box || !live()) return
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
  const stable = (tabs: Tab[], next: Tab[]) =>
    next.map((tab) => {
      const old = tabs.find((item) => same(item, tab))
      return old && equal(old, tab) ? old : tab
    })

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

  const send = (data: unknown) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(data))
  }

  const rest = () => {
    if (!store.focus && !store.edit) return
    setStore({ focus: false, edit: false })
  }

  const tap = () => {
    if (!ready() || !canvas) return
    setStore({ focus: true, edit: false })
    canvas.focus({ preventScroll: true })
  }

  const reveal = () => {
    const value = on()
    if (!value || taken(value)) return
    setStore("reveal", tabid(value))
  }

  const point = (x: number, y: number) => {
    if (!canvas) return
    return mapPoint(canvas, store.width, store.height, x, y)
  }

  const drive = (cmd: "back" | "forward" | "reload") => {
    const value = on()
    if (!value || !ready()) return
    void act(value.sessionID, cmd).catch(() => {})
  }

  const jump = () => {
    const value = on()
    const next = pageUrl(store.addr)
    if (!value || !ready() || !next) return
    rest()
    aim()
    void nav(value.sessionID, next)
      .then(() => syncViewport(true))
      .catch(() => {
        setStore("addr", value.url)
      })
  }

  const take = (tab: Tab) => {
    if (!params.id || !params.dir) return
    const id = tabid(tab)
    if (store.take === id) return
    const width = box ? Math.max(320, Math.floor(box.clientWidth)) : undefined
    const height = box ? Math.max(240, Math.floor(box.clientHeight)) : undefined
    const scale = dpr()
    setStore("take", id)
    aim()
    setStore("view", { sessionID: tab.sessionID, index: tab.index })
    void sdk.client.session
      .suspend({ sessionID: tab.sessionID, reason: "browser_takeover" })
      .then((result) => result.data)
      .then((result) => {
        if (result?.status.type !== "paused") return
        layout.takeover.enter(id)
        return select({ sessionID: tab.sessionID, index: tab.index, width, height, scale })
      })
      .then((data) => {
        if (!data) return
        patch(tab.sessionID, data)
        syncViewport(true)
      })
      .catch(() => {})
      .finally(() => {
        setStore("take", "")
        setStore("reveal", "")
      })
  }

  const resume = (tab: Tab) => {
    const id = tabid(tab)
    if (store.take === id) return
    setStore("take", id)
    void sdk.client.session
      .resume({ sessionID: tab.sessionID })
      .then(() => {
        layout.takeover.clear(id)
      })
      .catch(() => {})
      .finally(() => {
        setStore("take", "")
      })
  }

  const apply = (data: Tab[], root: string) => {
    const tabs = stable(store.tabs, data)
    layout.takeover.prune(tabs.map((tab) => tabid(tab)))
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

  const patch = (root: string, data: Group) => apply(merge(store.tabs, data), root)
  const refresh = (root: string, skip?: () => boolean) =>
    list(root)
      .then((data) => {
        if (skip?.()) return
        apply(data.tabs, root)
      })
      .catch(() => {})

  const choose = (tab: Tab) => {
    const root = params.id ?? tab.sessionID
    if (same(store.view, { sessionID: tab.sessionID, index: tab.index })) return
    aim()
    rest()
    setStore("reveal", "")
    if (!ready()) {
      if (!tab.active) return
      setStore("view", { sessionID: tab.sessionID, index: tab.index })
      return
    }
    setStore("view", { sessionID: tab.sessionID, index: tab.index })
    const width = box ? Math.max(320, Math.floor(box.clientWidth)) : undefined
    const height = box ? Math.max(240, Math.floor(box.clientHeight)) : undefined
    const scale = dpr()
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
    if (!opened() || !watch() || !live()) return
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
    let timer: number | undefined
    let dead = false
    let busy = false

    const load = () => {
      if (dead || busy) return
      busy = true
      void refresh(root, () => dead).finally(() => {
        busy = false
        if (dead) return
        timer = window.setTimeout(load, wait())
      })
    }

    const kick = () => {
      if (dead) return
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
      load()
    }

    kick()

    const seen = makeEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") kick()
    })
    const focus = makeEventListener(window, "focus", kick)

    onCleanup(() => {
      dead = true
      if (timer !== undefined) window.clearTimeout(timer)
      seen()
      focus()
    })
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
      void refresh(root)
    })
    onCleanup(stop)
  })

  createEffect(() => {
    const root = params.id
    if (!root || !opened()) return

    let dead = false
    const obs = new WebSocket(sock(`/browser/${root}/tabs/watch`))

    obs.addEventListener("message", (event) => {
      if (dead || typeof event.data !== "string") return
      const data = parse(event.data)
      if (!record(data) || data.type !== "ready") return
      void refresh(root, () => dead)
    })

    onCleanup(() => {
      dead = true
      if (obs.readyState !== WebSocket.CLOSING && obs.readyState !== WebSocket.CLOSED) obs.close()
    })
  })

  createEffect(() => {
    const value = on()
    if (!value) {
      layout.takeover.setCurrent()
      return
    }
    const id = tabid(value)
    if (!taken(value)) {
      layout.takeover.setCurrent()
      return
    }
    if (layout.takeover.current() === id) return
    layout.takeover.setCurrent(id)
  })

  createEffect(() => {
    const value = on()
    if (!value) return
    if (status(value.sessionID).type !== "paused") return
    if (taken(value)) return
    layout.takeover.enter(tabid(value))
  })

  createEffect(() => {
    for (const item of store.tabs) {
      if (!taken(item)) continue
      if (status(item.sessionID).type === "paused") continue
      if (store.take === tabid(item)) continue
      layout.takeover.clear(tabid(item))
    }
  })

  createEffect(() => {
    if (store.edit) return
    setStore("addr", url())
  })

  createEffect(() => {
    if (active()) return
    rest()
  })

  createEffect(() => {
    if (!opened()) return
    const stop = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        if (box?.contains(event.target as Node)) return
        rest()
      },
      { capture: true },
    )
    onCleanup(stop)
  })

  createEffect(() => {
    if (!opened() || !store.focus || !ready()) return
    const up = makeEventListener(
      window,
      "keyup",
      (event) => {
        if (document.activeElement !== canvas) return
        event.preventDefault()
        event.stopPropagation()
        send({
          type: "input_keyboard",
          eventType: "keyUp",
          ...keyData(event, "keyUp"),
        })
      },
      { capture: true },
    )
    const down = makeEventListener(
      window,
      "keydown",
      (event) => {
        if (document.activeElement !== canvas) return
        event.preventDefault()
        event.stopPropagation()
        send({
          type: "input_keyboard",
          eventType: "keyDown",
          ...keyData(event, "keyDown"),
        })
      },
      { capture: true },
    )
    const blur = makeEventListener(window, "blur", rest)
    onCleanup(() => {
      up()
      down()
      blur()
    })
  })

  createEffect(() => {
    if (!store.reveal) return
    const value = on()
    if (value && store.reveal === tabid(value) && !taken(value) && status(value.sessionID).type !== "paused") return
    setStore("reveal", "")
  })

  createEffect(() => {
    const sessionID = watch()
    if (!sessionID || !opened()) {
      if (opened()) {
        reset()
        setStore({
          loading: false,
          connected: false,
          screencasting: false,
          error: "",
          width: 0,
          height: 0,
        })
      }
      return
    }

    let done = false
    let seen = false
    let fail = false
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

    ws = new WebSocket(sock(`/browser/${sessionID}/stream/connect`))

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
        setStore({
          loading: false,
          error: "",
          connected: true,
          screencasting: true,
        })
        paint({
          data: frame,
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
      ws = undefined
    })
  })

  onCleanup(() => {
    if (timer !== undefined) window.clearTimeout(timer)
  })

  return (
    <Show when={desktop()}>
      <aside
        id="browser-panel"
        data-component="browser-panel"
        role="region"
        aria-label="Browser"
        aria-hidden={!opened()}
        inert={!opened()}
        class="relative min-w-0 h-full shrink-0 overflow-hidden bg-background-stronger"
        classList={{
          "pointer-events-none": !opened(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active(),
        }}
        style={{ width: opened() ? `${side()}px` : "0px" }}
      >
        <div class="size-full flex flex-col border-l border-border-weaker-base bg-background-stronger">
          <div class="h-11 px-3 flex items-center gap-3 border-b border-border-weaker-base bg-background-stronger shrink-0">
            <div class="shrink-0 flex items-center gap-2 text-12-medium text-text-strong">
              <Icon name="window-cursor" size="small" />
              <span>Browser</span>
            </div>
            <div class="shrink-0 flex items-center gap-1">
              <IconButton
                icon="arrow-left"
                variant="ghost"
                size="small"
                aria-label="Back"
                disabled={!ready()}
                onPointerDown={rest}
                onClick={() => drive("back")}
              />
              <IconButton
                icon="arrow-right"
                variant="ghost"
                size="small"
                aria-label="Forward"
                disabled={!ready()}
                onPointerDown={rest}
                onClick={() => drive("forward")}
              />
              <IconButton
                icon="reset"
                variant="ghost"
                size="small"
                aria-label="Reload"
                disabled={!ready()}
                onPointerDown={rest}
                onClick={() => drive("reload")}
              />
            </div>
            <div class="min-w-0 flex-1">
              <div
                class="h-8 flex items-center gap-2 rounded-lg border border-border-weak-base bg-background-base px-2.5"
                classList={{
                  "border-border-strong-base": active() && (store.edit || store.focus),
                }}
              >
                <Icon name="link" size="small" class="text-icon-weak" />
                <input
                  value={store.addr}
                  readOnly={!active()}
                  spellcheck={false}
                  class="flex-1 min-w-0 border-0 bg-transparent p-0 text-12-regular text-text-weak outline-none placeholder:text-text-weaker"
                  placeholder="No selected tab URL"
                  title={url() || "No selected tab URL"}
                  onInput={(event) => setStore("addr", event.currentTarget.value)}
                  onPointerDown={rest}
                  onFocus={(event) => {
                    if (!active()) {
                      event.currentTarget.blur()
                      return
                    }
                    rest()
                    setStore("edit", true)
                    event.currentTarget.select()
                  }}
                  onBlur={() => {
                    setStore("edit", false)
                    setStore("addr", url())
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      jump()
                      return
                    }
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    setStore("addr", url())
                    event.currentTarget.blur()
                  }}
                />
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-1.5 text-11-regular text-text-weak">
              <Show
                when={live()}
                fallback={
                  <Show
                    when={store.loading && !store.error}
                    fallback={
                      <>
                        <div class="size-1.5 rounded-full shrink-0 bg-icon-critical-base" />
                        <span>Disconnected</span>
                      </>
                    }
                  >
                    <>
                      <div class="size-1.5 rounded-full shrink-0 bg-icon-weak-base" />
                      <span>Connecting</span>
                    </>
                  </Show>
                }
              >
                <>
                  <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                  <span>{active() ? "Interactive" : "Connected"}</span>
                </>
              </Show>
            </div>
          </div>
          <Show
            when={shown().length > 0}
            fallback={
              <div class="h-10 px-3 flex items-center border-b border-border-weaker-base bg-background-stronger text-11-regular text-text-weak shrink-0">
                No tabs
              </div>
            }
          >
            <div data-component="browser-tabs" class="shrink-0">
              <Tabs
                variant="alt"
                value={cur()}
                class="!h-auto !flex-none !bg-transparent overflow-visible"
                data-scope="browser"
              >
                <Tabs.List>
                  <For each={shown()}>
                    {(tab) => (
                      <Tabs.Trigger
                        value={key(tab)}
                        title={tab.url || tab.title || `Tab ${tab.index + 1}`}
                        onClick={() => choose(tab)}
                        class="!shadow-none"
                        classList={{
                          "!text-text-strong": taken(tab),
                        }}
                        classes={{
                          button: "border-0 outline-none focus:outline-none focus-visible:outline-none !shadow-none !ring-0",
                        }}
                      >
                        <div class="flex items-center gap-2 min-w-0">
                          <div
                            class="relative size-4 shrink-0 rounded-[4px] border border-border-weak-base bg-surface-base overflow-hidden"
                            classList={{
                              "border-icon-interactive-base bg-surface-base-active": taken(tab),
                            }}
                          >
                            <div class="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-text-weaker">
                              {glyph(tab)}
                            </div>
                            <Show when={fav(tab.url)}>
                              {(src) => (
                                <img
                                  src={src()}
                                  alt=""
                                  class="absolute inset-0 size-full rounded-[4px] bg-background-base"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={(event) => {
                                    event.currentTarget.style.display = "none"
                                  }}
                                />
                              )}
                            </Show>
                          </div>
                          <div class="min-w-0 flex flex-col items-start justify-center leading-none">
                            <span class="max-w-full truncate text-12-medium">{name(tab)}</span>
                            <div class="flex items-center gap-1 min-w-0 text-[10px] text-text-weaker">
                              <Show when={taken(tab)}>
                                <span class="size-1.5 shrink-0 rounded-full bg-icon-interactive-base" />
                              </Show>
                              <Show when={mark(ids(), tab, params.id, title)}>
                                {(value) => (
                                  <span class="max-w-[10rem] truncate px-1 py-px rounded-sm border border-border-weak-base bg-surface-base text-[9px] text-text-weaker">
                                    {value()}
                                  </span>
                                )}
                              </Show>
                            </div>
                          </div>
                        </div>
                      </Tabs.Trigger>
                    )}
                  </For>
                </Tabs.List>
              </Tabs>
            </div>
          </Show>

          <div
            ref={box}
            data-prevent-autofocus
            class="flex-1 min-h-0 bg-black relative overflow-hidden outline-none flex items-center justify-center"
            classList={{
              "ring-1 ring-inset ring-icon-interactive-base": store.focus && ready(),
            }}
            onPointerDown={() => tap()}
            onContextMenu={(event) => {
              if (!ready()) return
              event.preventDefault()
            }}
          >
            <canvas
              ref={canvas}
              tabindex={ready() ? 0 : -1}
              aria-label="Agent browser stream"
              class="max-h-full max-w-full select-none outline-none"
              classList={{ hidden: !store.width || !store.height }}
              onFocus={() => setStore({ focus: true, edit: false })}
              onBlur={() => setStore("focus", false)}
              onMouseMove={(event) => {
                const hit = point(event.clientX, event.clientY)
                if (!hit || !ready()) return
                send({
                  type: "input_mouse",
                  eventType: "mouseMoved",
                  x: hit.x,
                  y: hit.y,
                  button: mouseButton(event.button),
                  clickCount: 0,
                  modifiers: mods(event),
                })
              }}
              onMouseDown={(event) => {
                const hit = point(event.clientX, event.clientY)
                if (!hit || !ready()) return
                event.preventDefault()
                tap()
                send({
                  type: "input_mouse",
                  eventType: "mousePressed",
                  x: hit.x,
                  y: hit.y,
                  button: mouseButton(event.button),
                  clickCount: 1,
                  modifiers: mods(event),
                })
              }}
              onMouseUp={(event) => {
                const hit = point(event.clientX, event.clientY)
                if (!hit || !ready()) return
                send({
                  type: "input_mouse",
                  eventType: "mouseReleased",
                  x: hit.x,
                  y: hit.y,
                  button: mouseButton(event.button),
                  clickCount: 0,
                  modifiers: mods(event),
                })
              }}
              onWheel={(event) => {
                const hit = point(event.clientX, event.clientY)
                if (!hit || !ready()) return
                event.preventDefault()
                send({
                  type: "input_mouse",
                  eventType: "mouseWheel",
                  x: hit.x,
                  y: hit.y,
                  button: "none",
                  clickCount: 0,
                  deltaX: event.deltaX,
                  deltaY: event.deltaY,
                  modifiers: mods(event),
                })
              }}
              onContextMenu={(event) => {
                if (!ready()) return
                event.preventDefault()
              }}
              onDblClick={reveal}
            />
            <Show when={action()}>
              {(item) => (
                <div class="absolute left-1/2 top-3 z-10 -translate-x-1/2">
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-full border border-border-weak-base bg-background-stronger/95 px-3 py-1.5 text-11-medium text-text-strong shadow-sm backdrop-blur-sm transition hover:border-border-strong-base disabled:opacity-50"
                    disabled={store.take === tabid(item().tab)}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (item().type === "take") {
                        take(item().tab)
                        return
                      }
                      resume(item().tab)
                    }}
                  >
                    <Icon name={item().type === "take" ? "window-cursor" : "arrow-right"} size="small" />
                    <span>{item().type === "take" ? "Take over" : "Resume"}</span>
                  </button>
                </div>
              )}
            </Show>
            <Show when={!store.width || !store.height}>
              <div class="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_42%)]">
                <div class="px-4 py-3 rounded-xl border border-border-weak-base bg-background-stronger text-12-regular text-text-weak shadow-sm">
                  <Show when={store.error} fallback={<span>{store.loading ? "Connecting browser stream..." : "No stream frame yet"}</span>}>
                    <span>{store.error}</span>
                  </Show>
                </div>
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
