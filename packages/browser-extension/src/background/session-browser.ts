// One session's browser: the tabs its agent may use and the experimental.browser attachment that
// exposes them. Mirrors the desktop pane (packages/gui-extensions/src/browser/pane.ts): the server
// plugin owns tools and permissions; this side owns tabs and runs commands.
import { OpenCode, isRpcError, isRpcInternalError, type JsonValue } from "@opencode/client/promise"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import type { BrowserState, BrowserStatus, PanelTab } from "../shared/protocol"
import { browserFailure, unsupported } from "./errors"
import { createBrowserPage, UnsupportedOperation, type BrowserPage } from "./page"
import type { Recording } from "./profiling"
import { normalizeURL, shareable } from "./policy"
import type { Service } from "./service"

type Entry = {
  id: Browser.TabID
  tabId: number
  kind: PanelTab["kind"]
  generation: number
  canGoBack: boolean
  canGoForward: boolean
  loadError?: string
  page?: BrowserPage
  /** When the agent last acted on this tab; downloads without a referrer go to the latest. */
  active?: number
}
type Stored = Pick<Entry, "id" | "tabId" | "kind" | "generation">
type Methods = (typeof Browser.Definition)["methods"]
type Connection = {
  abort: AbortController
  /** experimental.browser over the generic RPC route; inputs are already in their encoded JSON form. */
  call: <Method extends keyof Methods & string>(
    method: Method,
    input: Omit<Methods[Method]["input"]["Encoded"], "sessionID" | "connectionID">,
    signal?: AbortSignal,
  ) => Promise<unknown>
  send: (task: () => Promise<unknown>) => void
}

// Session context the agent sees as <context key="..."> blocks, so it knows where it runs and what the
// user is looking at. Without it agents reach for other browser automation and miss the shared tabs.
const GUIDANCE = [
  "You are running inside OpenCode Browser, opencode's side panel in the user's web browser.",
  "The browser.* tools control the user's real browser: tabs you open with browser.tabs.open and tabs the user shares from the panel (browser.tabs.list shows them). Use them for anything in the user's browser instead of other browser automation such as the browser-control skill or CLI.",
  "The user watches the tabs you use, and pointer actions show a cursor in the page. Move around a site the way a person would: find links and buttons with browser.snapshot or browser.find, then use browser.click, browser.fill, and browser.press. Use browser.navigate only to open a new site or an exact URL the user gave, and browser.evaluate to read data, not to click or navigate.",
  "If you need the page the user is looking at, or another tab they have open, and it is not shared, call browser.tabs.request (omit query for their current tab); they approve it in the panel. You can also open the URL yourself with browser.tabs.open.",
  "To change how a website looks or behaves persistently, write a site script and install it with site_scripts.install; the user approves it in the panel. Never ask the user to install Tampermonkey or Violentmonkey.",
].join("\n")

const decodeCommand = Schema.decodeUnknownSync(Browser.Command)
const decodeControl = Schema.decodeUnknownOption(Browser.Control)
const encodeOutcome = Schema.encodeSync(Browser.Outcome)

export type SessionBrowser = Awaited<ReturnType<typeof createSessionBrowser>>

export async function createSessionBrowser(input: {
  sessionID: string
  location: { directory: string; workspaceID?: string }
  /** The window new agent tabs open in; follows the panel that last showed this session. */
  windowId: number
  service: Service
  changed: (state: BrowserState) => void
  /** Shows a server file (browser.preview) in the panel showing this session; throws if none does. */
  preview: (path: string) => void
}) {
  const storageKey = `browser:${input.sessionID}`
  const entries = new Map<Browser.TabID, Entry>()
  const requests = new Map<string, AbortController>()
  const tabs = new Map<number, chrome.tabs.Tab>()
  let windowId = input.windowId
  let status: BrowserStatus = "idle"
  let error: string | undefined
  let connection: Connection | undefined
  let wanted = false
  let disposed = false
  let attempts = 0
  let refs = 0
  let groupId: number | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let stateTimer: ReturnType<typeof setTimeout> | undefined
  let guided = false
  const recording: { recording?: Recording } = {}
  let lastPage: string | undefined

  // Tabs survive a service worker restart; their IDs must too, or the agent's tab IDs go stale.
  const stored = ((await chrome.storage.session.get(storageKey))[storageKey] ?? []) as Stored[]
  await Promise.all(
    stored.map(async (item) => {
      const tab = await chrome.tabs.get(item.tabId).catch(() => undefined)
      if (!tab) return
      tabs.set(item.tabId, tab)
      entries.set(item.id, { ...item, canGoBack: false, canGoForward: false })
    }),
  )

  const persist = () =>
    void chrome.storage.session.set({
      [storageKey]: Array.from(entries.values(), (entry) => ({
        id: entry.id,
        tabId: entry.tabId,
        kind: entry.kind,
        generation: entry.generation,
      })),
    })

  const tabState = (entry: Entry): Browser.Tab => {
    const tab = tabs.get(entry.tabId)
    return {
      id: entry.id,
      url: (tab?.url || tab?.pendingUrl || "about:blank").slice(0, 16_384),
      title: (tab?.title ?? "").slice(0, 2_048),
      loading: tab?.status === "loading",
      ...(entry.loadError ? { loadError: entry.loadError.slice(0, 2_048) } : {}),
      canGoBack: entry.canGoBack,
      canGoForward: entry.canGoForward,
      generation: entry.generation,
    }
  }
  const inventory = (): Browser.State => {
    const list = Array.from(entries.values())
    return {
      tabs: list.map(tabState),
      focusedTabID: list.find((entry) => tabs.get(entry.tabId)?.active)?.id ?? null,
    }
  }
  const snapshot = (): BrowserState => ({
    sessionID: input.sessionID,
    status,
    ...(error ? { error } : {}),
    tabs: Array.from(entries.values(), (entry) => {
      const tab = tabs.get(entry.tabId)
      return {
        id: entry.id,
        chromeTabID: entry.tabId,
        title: tab?.title || tab?.url || "New tab",
        url: tab?.url ?? "",
        ...(tab?.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        kind: entry.kind,
        active: tab?.active ?? false,
        loading: tab?.status === "loading",
      }
    }),
  })
  const notify = () => input.changed(snapshot())
  const setStatus = (next: BrowserStatus, message?: string) => {
    status = next
    error = message
    notify()
  }
  // The server resolves every tab ID against the last state it received, so state is sent before any
  // result that names a new tab. Coalesce bursts of tab events into one report.
  const publish = (immediate = false) => {
    persist()
    notify()
    clearTimeout(stateTimer)
    const send = () => {
      const current = connection
      if (!current || status !== "connected") return
      current.send(() =>
        current.call("state", { state: Schema.encodeSync(Browser.State)(inventory()) }).catch((cause: unknown) => {
          if (!unavailable(cause)) throw cause
        }),
      )
    }
    if (immediate) return send()
    stateTimer = setTimeout(send, 50)
  }
  const find = (tabId: number) => Array.from(entries.values()).find((entry) => entry.tabId === tabId)
  const page = (entry: Entry) =>
    (entry.page ??= createBrowserPage({
      tabId: entry.tabId,
      state: () => tabState(entry),
      ref: () => `e${++refs}`,
      detached: () => {
        entry.page = undefined
      },
      history: (value) => {
        entry.canGoBack = value.canGoBack
        entry.canGoForward = value.canGoForward
        publish()
      },
      shared: recording,
    }))
  const add = (tab: chrome.tabs.Tab, kind: Entry["kind"]) => {
    const entry: Entry = {
      id: Browser.TabID.make(`tab_${crypto.randomUUID()}`),
      tabId: tab.id!,
      kind,
      generation: 0,
      canGoBack: false,
      canGoForward: false,
    }
    tabs.set(tab.id!, tab)
    entries.set(entry.id, entry)
    return entry
  }
  const drop = (entry: Entry) => {
    entries.delete(entry.id)
    tabs.delete(entry.tabId)
    void entry.page?.dispose()
    entry.page = undefined
  }
  const require = (tabID: Browser.TabID) => {
    const entry = entries.get(tabID)
    if (!entry)
      throw new Error(
        "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID from this session; a closed tab is not replaced automatically.",
      )
    return entry
  }
  const group = async (tabId: number) => {
    // A group the user dissolved or closed is recreated rather than reused.
    const existing = groupId === undefined ? undefined : await chrome.tabGroups.get(groupId).catch(() => undefined)
    if (existing && existing.windowId === (await chrome.tabs.get(tabId)).windowId) {
      await chrome.tabs.group({ tabIds: [tabId], groupId: existing.id })
      return
    }
    groupId = await chrome.tabs.group({ tabIds: [tabId] })
    await chrome.tabGroups.update(groupId, { title: "opencode", color: "grey" })
  }
  const targetWindow = async () => {
    const window = await chrome.windows.get(windowId).catch(() => undefined)
    if (window) return window.id!
    const fallback = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    windowId = fallback.id!
    return windowId
  }

  const execute = async (command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> => {
    const action = command.action
    if (action.type === "tabs.list") return { value: inventory(), files: [] }
    if (action.type === "preview") {
      input.preview(action.path)
      return { value: { path: action.path }, files: [] }
    }
    if (action.type === "tabs.open") {
      const url = normalizeURL(action.url ?? "about:blank")
      const tab = await chrome.tabs.create({ windowId: await targetWindow(), url, active: action.focus !== false })
      const entry = add(tab, "opened")
      await group(tab.id!).catch(() => undefined)
      publish(true)
      if (url !== "about:blank") await settle(entry, signal)
      publish(true)
      return { value: tabState(entry), files: [] }
    }
    const entry = require(action.tabID)
    if (action.type === "tabs.focus") {
      await chrome.tabs.update(entry.tabId, { active: true })
      return { value: tabState(entry), files: [] }
    }
    if (action.type === "tabs.close") {
      // Shared tabs belong to the user: closing one only takes it away from the agent.
      if (entry.kind === "opened") await chrome.tabs.remove(entry.tabId).catch(() => undefined)
      drop(entry)
      publish(true)
      return { value: inventory(), files: [] }
    }
    entry.active = Date.now()
    const result = await page(entry).execute(command, signal)
    publish(true)
    return result
  }

  const settle = async (entry: Entry, signal: AbortSignal) => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && !signal.aborted) {
      const tab = await chrome.tabs.get(entry.tabId).catch(() => undefined)
      if (!tab) throw new Error("The tab closed while loading.")
      tabs.set(entry.tabId, tab)
      if (tab.status === "complete") break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (entry.loadError) throw new Error(entry.loadError)
  }

  const handle = async (current: Connection, requestID: string) => {
    const abort = new AbortController()
    requests.set(requestID, abort)
    const reply = (outcome: Browser.Outcome) =>
      current.send(() => current.call("result", { requestID, outcome: encodeOutcome(outcome) }))
    const raw = await current.call("command", { requestID }).catch((cause: unknown) => {
      // A request cancelled before retrieval is gone; only that request fails.
      if (!abort.signal.aborted) console.warn("[opencode-browser] command fetch failed", cause)
      return undefined
    })
    if (raw === undefined) return requests.delete(requestID)
    const command = (() => {
      try {
        return decodeCommand(raw)
      } catch {
        return undefined
      }
    })()
    // An operation this extension cannot decode comes from a newer plugin; answer so the agent does not wait.
    if (!command) {
      reply({
        type: "failure",
        code: "unsupported",
        message:
          "OpenCode Browser does not support the requested browser operation. Ask the user to update the extension, or use another operation.",
      })
      return requests.delete(requestID)
    }
    const outcome = await execute(command, abort.signal).then(
      (result): Browser.Outcome => ({ type: "success", result }),
      (cause: unknown) => (cause instanceof UnsupportedOperation ? unsupported(command.action) : browserFailure(command.action, cause)),
    )
    requests.delete(requestID)
    reply(outcome)
  }

  const connect = async (): Promise<"closed" | "replaced" | "unsupported" | "stopped"> => {
    const info = await input.service.get()
    const client = OpenCode.make({
      baseUrl: info.url,
      headers: { Authorization: `Basic ${btoa(`opencode:${info.password}`)}` },
    })
    const abort = new AbortController()
    const connectionID = crypto.randomUUID()
    let queue = Promise.resolve()
    const current: Connection = {
      abort,
      call: (method, body, signal) =>
        client.rpc
          .call(
            {
              rpcID: Browser.Definition.id,
              method,
              input: { ...body, sessionID: input.sessionID, connectionID } as JsonValue,
              location: { directory: input.location.directory },
            },
            { signal: signal ?? abort.signal },
          )
          .then((response) => response.output)
          .catch((cause: unknown) => {
            if (!isRpcError(cause) && !isRpcInternalError(cause)) throw cause
            throw { type: cause.type, message: cause.message }
          }),
      send: (task) => {
        queue = queue.then(task).then(
          () => undefined,
          (cause: unknown) => console.warn("[opencode-browser] send failed", cause),
        )
      },
    }
    connection = current
    const connected = Promise.withResolvers<void>()
    let attached = false
    let incompatible = false
    const events = (async () => {
      for await (const event of client.event.subscribe({ signal: abort.signal })) {
        if (event.type === "server.connected") connected.resolve()
        if (event.type !== "rpc.experimental.browser.control") continue
        const message = decodeControl(event.data)
        if (message._tag === "None") {
          incompatible = true
          abort.abort()
          return
        }
        if (message.value.connectionID !== connectionID) continue
        if (message.value.type === "attached") {
          attached = true
          attempts = 0
          setStatus("connected")
          publish(true)
          if (!guided) {
            guided = true
            void putContext("opencode-browser", GUIDANCE)
          }
          continue
        }
        if (message.value.type === "cancel") {
          requests.get(message.value.requestID)?.abort()
          continue
        }
        void handle(current, message.value.requestID)
      }
    })().catch((cause: unknown) => {
      if (!abort.signal.aborted) throw cause
    })
    try {
      await Promise.race([connected.promise, events.then(() => Promise.reject(new Error("Event stream ended.")))])
      return await Promise.race([
        current.call("attach", { version: 4 }).then((result) => (result === "replaced" ? "replaced" : "closed")),
        events.then(() => Promise.reject(new Error("Event stream ended."))),
      ])
    } catch (cause) {
      if (incompatible) return "unsupported"
      if (!wanted || disposed) return "stopped"
      const type = typeof cause === "object" && cause && "type" in cause ? String(cause.type) : undefined
      if (!attached && (type === "rpc.method_not_found" || type === "rpc.invalid_input" || type === "rpc.unavailable"))
        return "unsupported"
      throw cause
    } finally {
      abort.abort()
      requests.forEach((request) => request.abort())
      requests.clear()
      if (connection === current) connection = undefined
    }
  }

  const putContext = async (key: string, value: string) => {
    const info = await input.service.get()
    await OpenCode.make({
      baseUrl: info.url,
      headers: { Authorization: `Basic ${btoa(`opencode:${info.password}`)}` },
    })
      .session.instructions.entry.put({ sessionID: input.sessionID, key, value })
      .catch((cause: unknown) => console.warn("[opencode-browser] session context failed", key, cause))
  }

  const run = async () => {
    while (wanted && !disposed) {
      setStatus("connecting")
      const outcome = await connect().catch((cause: unknown) => {
        error = cause instanceof Error ? cause.message : String(cause)
        return "error" as const
      })
      if (!wanted || disposed || outcome === "stopped") return
      if (outcome === "replaced") {
        wanted = false
        return setStatus("replaced", "Another opencode client is using this session's browser.")
      }
      if (outcome === "unsupported") {
        wanted = false
        return setStatus("unsupported", "This opencode server has no compatible browser plugin. Update opencode.")
      }
      // The server closed the attachment or the connection dropped: reconnect with backoff.
      setStatus("connecting", outcome === "error" ? error : undefined)
      await new Promise<void>((resolve) => {
        retry = setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempts++))
      })
    }
  }

  return {
    sessionID: input.sessionID,
    snapshot,
    owns: (tabId: number) => find(tabId) !== undefined,
    get empty() {
      return entries.size === 0
    },
    /** Attach unless another client replaced this one; a replacement waits for an explicit takeover. */
    want(window: number) {
      windowId = window
      if (wanted || status === "replaced" || status === "unsupported") return notify()
      wanted = true
      void run()
    },
    takeover(window: number) {
      windowId = window
      if (wanted) return
      wanted = true
      void run()
    },
    /** Shares a user's tab with this session and returns its tabID (the existing one when already shared). */
    async share(tabId: number) {
      const existing = find(tabId)
      if (existing) return existing.id
      const tab = await chrome.tabs.get(tabId)
      if (!shareable(tab.url)) throw new Error("Only regular web pages can be shared.")
      const entry = add(tab, "shared")
      publish()
      return entry.id
    },
    /** The tabID this session uses for a browser tab, if it has it. */
    tabIDFor(tabId: number) {
      return find(tabId)?.id
    },
    unshare(tabID: string) {
      const entry = entries.get(Browser.TabID.make(tabID))
      if (!entry) return
      drop(entry)
      publish()
    },
    async focus(tabID: string) {
      const entry = entries.get(Browser.TabID.make(tabID))
      if (!entry) return
      await chrome.tabs.update(entry.tabId, { active: true })
      await chrome.windows.update((await chrome.tabs.get(entry.tabId)).windowId, { focused: true })
    },
    /** Takes a tab away without closing it, because another session now has it. */
    release(tabId: number) {
      const entry = find(tabId)
      if (!entry) return
      drop(entry)
      publish()
    },
    tabUpdated(tab: chrome.tabs.Tab) {
      if (!find(tab.id!)) return
      tabs.set(tab.id!, tab)
      publish()
    },
    tabRemoved(tabId: number) {
      const entry = find(tabId)
      if (!entry) return
      drop(entry)
      publish()
    },
    /** A new main-frame document committed: refs and diagnostics from the old one are stale. */
    committed(tabId: number) {
      const entry = find(tabId)
      if (!entry) return
      entry.generation++
      entry.loadError = undefined
      entry.page?.reset()
      publish()
    },
    /** Tells the agent which page the user is looking at; repeated values are not resent. */
    page(tab: chrome.tabs.Tab | undefined) {
      const entry = tab?.id === undefined ? undefined : find(tab.id)
      const value = !tab?.url
        ? "The user is not looking at a web page."
        : [
            `The user is looking at: ${tab.title || "Untitled"} (${tab.url}).`,
            entry
              ? `It is shared with you as tabID ${entry.id}.`
              : shareable(tab.url)
                ? "It is not shared with you. Call browser.tabs.request({}) to ask the user to share it, or open the URL in your own tab with browser.tabs.open."
                : "It is a browser page that extensions cannot control.",
          ].join(" ")
      if (value === lastPage) return
      lastPage = value
      void putContext("opencode-browser.page", value)
    },
    /** Claims a download if it came from one of this session's tabs; returns whether it did. */
    download(item: chrome.downloads.DownloadItem) {
      const list = Array.from(entries.values())
      const byReferrer = item.referrer ? list.find((entry) => tabs.get(entry.tabId)?.url === item.referrer) : undefined
      // A download the agent just triggered (within 15 seconds) belongs to the tab it was using.
      const recent = list
        .filter((entry) => entry.active && Date.now() - entry.active < 15_000)
        .sort((a, b) => (b.active ?? 0) - (a.active ?? 0))[0]
      const owner = byReferrer ?? recent
      if (!owner) return false
      page(owner).download(item)
      return true
    },
    downloadChanged(item: chrome.downloads.DownloadItem) {
      entries.forEach((entry) => entry.page?.downloadChanged(item))
    },
    loadFailed(tabId: number, message: string) {
      const entry = find(tabId)
      if (!entry || message === "net::ERR_ABORTED") return
      entry.loadError = message
      publish()
    },
    async dispose() {
      disposed = true
      wanted = false
      clearTimeout(retry)
      clearTimeout(stateTimer)
      connection?.abort.abort()
      await Promise.all(Array.from(entries.values(), (entry) => entry.page?.dispose()))
    },
  }
}

function unavailable(cause: unknown) {
  return typeof cause === "object" && cause !== null && "type" in cause && cause.type === "unavailable"
}
