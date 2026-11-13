import { Option, Schema } from "effect"
import type { BrowserWindow, Extension, WebContents } from "electron"
import { method, none, optional, type ApiModule, type Emit, type ExtensionContext, type Wire } from "./api"
import { matchesHost } from "./match-pattern"

/** A tab of a pane in the profile, as the pane hands it to extensions, and what extensions may do with it. */
export type PaneTab = {
  readonly contents: WebContents
  readonly window: BrowserWindow
  /** Whether it is the focused tab of its pane. */
  readonly focused: () => boolean
  /** Opens a tab in the same pane, which the pane's address policy may refuse. */
  readonly open: (url: string, active: boolean) => Promise<WebContents>
  readonly focus: () => void
  readonly close: () => void
  readonly navigate: (url: string) => Promise<void>
}

/** A tab as `chrome.tabs` describes it, before what the extension may not see is taken out. */
export type TabSnapshot = {
  readonly id: number
  readonly index: number
  readonly windowId: number
  readonly active: boolean
  readonly url: string
  readonly title: string
  readonly status: "loading" | "complete"
  readonly audible: boolean
  readonly muted: boolean
}

const TabQuery = Schema.Struct({
  active: optional(Schema.Boolean),
  highlighted: optional(Schema.Boolean),
  currentWindow: optional(Schema.Boolean),
  lastFocusedWindow: optional(Schema.Boolean),
  windowId: optional(Schema.Number),
  index: optional(Schema.Number),
  url: optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  title: optional(Schema.String),
  status: optional(Schema.String),
  audible: optional(Schema.Boolean),
  muted: optional(Schema.Boolean),
})

export type TabQuery = typeof TabQuery.Type

const TabChange = Schema.Struct({
  url: optional(Schema.String),
  active: optional(Schema.Boolean),
  highlighted: optional(Schema.Boolean),
  muted: optional(Schema.Boolean),
})

const TabCreate = Schema.Struct({
  url: optional(Schema.String),
  active: optional(Schema.Boolean),
  windowId: optional(Schema.Number),
})

const WindowQuery = Schema.Struct({ populate: optional(Schema.Boolean) })

const WindowChange = Schema.Struct({
  focused: optional(Schema.Boolean),
  state: optional(Schema.String),
})

const WINDOW_ID_NONE = -1

const WINDOW_ID_CURRENT = -2

/** Whether a tab answers a `chrome.tabs.query`, given the window that is current for the caller. */
export function matchesQuery(
  tab: TabSnapshot,
  query: TabQuery,
  windows: { readonly current?: number; readonly lastFocused?: number },
) {
  const windowId = query.windowId === WINDOW_ID_CURRENT ? windows.current : query.windowId
  const urls = query.url === undefined || query.url === null ? [] : [query.url].flat()

  return (
    (query.active == null || query.active === tab.active) &&
    (query.highlighted == null || query.highlighted === tab.active) &&
    (query.currentWindow == null || query.currentWindow === (tab.windowId === windows.current)) &&
    (query.lastFocusedWindow == null || query.lastFocusedWindow === (tab.windowId === windows.lastFocused)) &&
    (windowId == null || windowId === tab.windowId) &&
    (query.index == null || query.index === tab.index) &&
    (urls.length === 0 || matchesHost(urls, tab.url)) &&
    (query.title == null || wildcard(query.title).test(tab.title)) &&
    (query.status == null || query.status === tab.status) &&
    (query.audible == null || query.audible === tab.audible) &&
    (query.muted == null || query.muted === tab.muted)
  )
}

/** A tab for an extension: its URL and title only with the `tabs` permission or host access to it. */
export function tabInfo(tab: TabSnapshot, revealed: boolean) {
  const info = {
    id: tab.id,
    index: tab.index,
    windowId: tab.windowId,
    active: tab.active,
    highlighted: tab.active,
    selected: tab.active,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    status: tab.status,
    audible: tab.audible,
    mutedInfo: { muted: tab.muted },
  }

  return revealed ? { ...info, url: tab.url, title: tab.title } : info
}

/** Whether an extension may read a tab's URL and title. */
export function reveals(manifest: { readonly permissions: readonly string[]; readonly hosts: readonly string[] }, url: string) {
  return manifest.permissions.includes("tabs") || matchesHost(manifest.hosts, url)
}

const Declared = Schema.Struct({
  permissions: Schema.optional(Schema.Array(Schema.Unknown)),
  host_permissions: Schema.optional(Schema.Array(Schema.Unknown)),
})

/** An extension's declared permissions and host patterns; MV2 lists host patterns among its permissions. */
export function declared(extension: Pick<Extension, "manifest">) {
  const manifest = Option.getOrUndefined(Schema.decodeUnknownOption(Declared)(extension.manifest))
  const permissions = (manifest?.permissions ?? []).filter(Schema.is(Schema.String))
  const hosts = (manifest?.host_permissions ?? []).filter(Schema.is(Schema.String))

  return { permissions, hosts: [...hosts, ...permissions.filter((item) => item.includes("://") || item === "<all_urls>")] }
}

function wildcard(pattern: string) {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
}

export type ExtensionTabs = ReturnType<typeof createExtensionTabs>

/** The window that has focus now, if any, and the one that had it last. */
type Focus = { current?: number; last?: number }

/**
 * The pane's tabs and windows as `chrome.tabs` and `chrome.windows` see them. A tab's id is its web contents' id,
 * the id Chromium's own `tabs.sendMessage`, `tabs.executeScript` and `scripting.executeScript` use, so those keep
 * working on the tabs this reports. A popup's current tab is the active tab of the window it opened over.
 */
export function createExtensionTabs(input: { emit: Emit; extensions: () => readonly Extension[] }) {
  const tabs = new Map<number, PaneTab>()
  const popups = new Map<number, number>()
  const windows = new Map<number, BrowserWindow>()
  // The tab each window last activated, and the window that last had focus.
  const activated = new Map<number, number>()
  const focus: Focus = {}
  const watchers = new Set<(tab: PaneTab) => (() => void) | void>()

  const inWindow = (windowId: number) => [...tabs.values()].filter((tab) => tab.window.id === windowId)

  const activeOf = (windowId: number) => {
    const candidates = inWindow(windowId).filter((tab) => tab.focused())
    const last = activated.get(windowId)

    return candidates.find((tab) => tab.contents.id === last) ?? candidates[0]
  }

  const snapshot = (tab: PaneTab): TabSnapshot => ({
    id: tab.contents.id,
    index: inWindow(tab.window.id).indexOf(tab),
    windowId: tab.window.id,
    active: activeOf(tab.window.id) === tab,
    url: tab.contents.getURL(),
    title: tab.contents.getTitle(),
    status: tab.contents.isLoading() ? "loading" : "complete",
    audible: tab.contents.isCurrentlyAudible(),
    muted: tab.contents.isAudioMuted(),
  })

  const infoFor = (extension: Pick<Extension, "manifest">, tab: PaneTab) => {
    const value = snapshot(tab)

    return tabInfo(value, reveals(declared(extension), value.url))
  }

  // Each extension hears a tab event with what it may see of the tab.
  const emitTab = (name: string, tab: PaneTab, args: (info: Wire, revealed: boolean) => readonly Wire[]) =>
    input.extensions().forEach((extension) => {
      const value = snapshot(tab)
      const revealed = reveals(declared(extension), value.url)
      input.emit(name, args(tabInfo(value, revealed), revealed), extension.id)
    })

  const currentWindow = (context: ExtensionContext) => {
    const id = context.contents?.id
    const owner = id === undefined ? undefined : (tabs.get(id)?.window.id ?? popups.get(id))

    return owner ?? focus.current ?? focus.last
  }

  const tabFor = (id: number) => {
    const tab = tabs.get(id)

    if (!tab) throw new Error(`No tab with id: ${id}.`)

    return tab
  }

  const windowInfo = (extension: Pick<Extension, "manifest">, win: BrowserWindow, populate: boolean) => {
    const bounds = win.getBounds()
    const state = win.isMinimized() ? "minimized" : win.isFullScreen() ? "fullscreen" : "normal"

    const info = {
      id: win.id,
      focused: win.isFocused(),
      top: bounds.y,
      left: bounds.x,
      width: bounds.width,
      height: bounds.height,
      incognito: false,
      type: "normal",
      state: state === "normal" && win.isMaximized() ? "maximized" : state,
      alwaysOnTop: win.isAlwaysOnTop(),
    }

    return populate ? { ...info, tabs: inWindow(win.id).map((tab) => infoFor(extension, tab)) } : info
  }

  const windowFor = (id: number) => {
    const win = windows.get(id)

    if (!win || win.isDestroyed()) throw new Error(`No window with id: ${id}.`)

    return win
  }

  const track = (win: BrowserWindow) => {
    if (windows.has(win.id)) return
    const id = win.id
    windows.set(id, win)

    const focused = () => {
      focus.current = id
      focus.last = id
      input.emit("windows.onFocusChanged", [id])
    }

    const blurred = () => {
      if (focus.current !== id) return
      focus.current = undefined
      input.emit("windows.onFocusChanged", [WINDOW_ID_NONE])
    }

    const bounds = () =>
      input.extensions().forEach((extension) =>
        input.emit("windows.onBoundsChanged", [windowInfo(extension, win, false)], extension.id),
      )

    if (win.isFocused()) {
      focus.current = id
      focus.last = id
    }

    win.on("focus", focused)
    win.on("blur", blurred)
    win.on("resized", bounds)
    win.on("moved", bounds)
    win.once("closed", () => {
      windows.delete(id)
      activated.delete(id)
      input.emit("windows.onRemoved", [id])
    })
    input.extensions().forEach((extension) =>
      input.emit("windows.onCreated", [windowInfo(extension, win, false)], extension.id),
    )
  }

  const create = async (context: ExtensionContext, options: typeof TabCreate.Type) => {
    const windowId = options.windowId == null || options.windowId === WINDOW_ID_CURRENT ? currentWindow(context) : options.windowId
    const anchor = windowId === undefined ? undefined : (activeOf(windowId) ?? inWindow(windowId)[0])
    const fallback = anchor ?? [...tabs.values()][0]

    if (!fallback) throw new Error("No browser pane is open to add a tab to.")
    const url = new URL(options.url ?? "about:blank", `chrome-extension://${context.extension.id}/`).href
    const contents = await fallback.open(url, options.active ?? true)
    const tab = tabs.get(contents.id)

    return tab ? infoFor(context.extension, tab) : undefined
  }

  const module: ApiModule = {
    namespaces: [
      {
        path: "tabs",
        methods: ["query", "get", "getCurrent", "create", "update", "remove", "highlight"],
        events: ["onCreated", "onUpdated", "onActivated", "onRemoved", "onHighlighted", "onReplaced", "onMoved"],
        constants: { TAB_ID_NONE: -1, TAB_INDEX_NONE: -1 },
      },
      {
        path: "windows",
        methods: ["get", "getCurrent", "getLastFocused", "getAll", "create", "update", "remove"],
        events: ["onCreated", "onRemoved", "onFocusChanged", "onBoundsChanged"],
        constants: { WINDOW_ID_NONE, WINDOW_ID_CURRENT },
      },
    ],
    methods: {
      "tabs.query": method(Schema.Tuple([optional(TabQuery)]), (context, [query]) => {
        const windows = { current: currentWindow(context), lastFocused: focus.last }

        return [...tabs.values()].flatMap((tab) =>
          matchesQuery(snapshot(tab), query ?? {}, windows) ? [infoFor(context.extension, tab)] : [],
        )
      }),
      "tabs.get": method(Schema.Tuple([Schema.Number]), (context, [id]) => infoFor(context.extension, tabFor(id))),
      "tabs.getCurrent": method(none, (context) => {
        const tab = context.contents ? tabs.get(context.contents.id) : undefined

        return tab ? infoFor(context.extension, tab) : undefined
      }),
      "tabs.create": method(Schema.Tuple([optional(TabCreate)]), (context, [options]) => create(context, options ?? {})),
      "tabs.update": method(
        Schema.Union([Schema.Tuple([Schema.Number, TabChange]), Schema.Tuple([TabChange])]),
        async (context, args) => {
          const [id, change] = args.length === 2 ? args : [undefined, args[0]]
          const windowId = currentWindow(context)
          const tab = id === undefined ? (windowId === undefined ? undefined : activeOf(windowId)) : tabFor(id)

          if (!tab) throw new Error("No tab to update.")

          if (change.muted != null) tab.contents.setAudioMuted(change.muted)

          if (change.url != null)
            await tab.navigate(new URL(change.url, `chrome-extension://${context.extension.id}/`).href)

          if (change.active || change.highlighted) tab.focus()

          return infoFor(context.extension, tab)
        },
      ),
      "tabs.remove": method(Schema.Tuple([Schema.Union([Schema.Number, Schema.Array(Schema.Number)])]), (_context, [ids]) => {
        ;[ids].flat().forEach((id) => tabFor(id).close())
      }),
      "tabs.highlight": method(
        Schema.Tuple([Schema.Struct({ tabs: Schema.Union([Schema.Number, Schema.Array(Schema.Number)]) })]),
        (context, [info]) => {
          const tab = [...tabs.values()].find((item) => item.contents.id === [info.tabs].flat()[0])
          tab?.focus()

          return tab ? windowInfo(context.extension, tab.window, true) : undefined
        },
      ),
      "windows.get": method(Schema.Tuple([Schema.Number, optional(WindowQuery)]), (context, [id, query]) =>
        windowInfo(context.extension, windowFor(id === WINDOW_ID_CURRENT ? (currentWindow(context) ?? id) : id), !!query?.populate),
      ),
      "windows.getCurrent": method(Schema.Tuple([optional(WindowQuery)]), (context, [query]) => {
        const id = currentWindow(context)

        if (id === undefined) throw new Error("No current window.")

        return windowInfo(context.extension, windowFor(id), !!query?.populate)
      }),
      "windows.getLastFocused": method(Schema.Tuple([optional(WindowQuery)]), (context, [query]) => {
        if (focus.last === undefined) throw new Error("No window has had focus.")

        return windowInfo(context.extension, windowFor(focus.last), !!query?.populate)
      }),
      "windows.getAll": method(Schema.Tuple([optional(WindowQuery)]), (context, [query]) =>
        [...windows.values()].flatMap((win) =>
          win.isDestroyed() ? [] : [windowInfo(context.extension, win, !!query?.populate)],
        ),
      ),
      // A new window becomes a tab of the current pane: the app has no windows of its own for extensions.
      "windows.create": method(
        Schema.Tuple([optional(Schema.Struct({ url: optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])), focused: optional(Schema.Boolean) }))]),
        async (context, [options]) => {
          const urls = options?.url == null ? [undefined] : [options.url].flat()
          await Promise.all(urls.map((url) => create(context, { url, active: true })))
          const id = currentWindow(context)

          return id === undefined ? undefined : windowInfo(context.extension, windowFor(id), true)
        },
      ),
      "windows.update": method(Schema.Tuple([Schema.Number, WindowChange]), (context, [id, change]) => {
        const win = windowFor(id === WINDOW_ID_CURRENT ? (currentWindow(context) ?? id) : id)

        if (change.state === "minimized") win.minimize()

        if (change.state === "maximized") win.maximize()

        if (change.focused || change.state === "normal") win.focus()

        return windowInfo(context.extension, win, false)
      }),
      "windows.remove": method(none, () => {
        throw new Error("Extensions cannot close app windows.")
      }),
    },
  }

  const activate = (id: number) => {
    const tab = tabs.get(id)

    if (!tab || activated.get(tab.window.id) === id) return
    activated.set(tab.window.id, id)
    input.emit("tabs.onActivated", [{ tabId: id, windowId: tab.window.id }])
  }

  return {
    module,
    /**
     * Hands a pane tab to extensions until the returned release; `tabs.onCreated` hears of it, and of every change
     * Chrome reports through `tabs.onUpdated`.
     */
    register(tab: PaneTab) {
      track(tab.window)
      const id = tab.contents.id
      const contents = tab.contents
      tabs.set(id, tab)
      emitTab("tabs.onCreated", tab, (info) => [info])

      const updated = (change: (revealed: boolean) => Record<string, Wire>) =>
        emitTab("tabs.onUpdated", tab, (info, revealed) => [id, change(revealed), info])

      const loading = () => updated(() => ({ status: "loading" }))
      const complete = () => updated(() => ({ status: "complete" }))
      const navigated = () => updated((revealed) => (revealed ? { url: contents.getURL() } : {}))
      const titled = () => updated((revealed) => (revealed ? { title: contents.getTitle() } : {}))
      const audio = () => updated(() => ({ audible: contents.isCurrentlyAudible() }))
      const focused = () => activate(id)
      contents.on("did-start-loading", loading)
      contents.on("did-stop-loading", complete)
      contents.on("did-navigate", navigated)
      contents.on("page-title-updated", titled)
      contents.on("audio-state-changed", audio)
      contents.on("focus", focused)
      const releases = [...watchers].flatMap((watcher) => watcher(tab) ?? [])

      return () => {
        if (!tabs.delete(id)) return

        if (!contents.isDestroyed()) {
          contents.off("did-start-loading", loading)
          contents.off("did-stop-loading", complete)
          contents.off("did-navigate", navigated)
          contents.off("page-title-updated", titled)
          contents.off("audio-state-changed", audio)
          contents.off("focus", focused)
        }

        releases.forEach((release) => release())
        input.emit("tabs.onRemoved", [id, { windowId: tab.window.id, isWindowClosing: tab.window.isDestroyed() }])
      }
    },
    /** The pane focused a tab, or the user clicked into it. */
    activated: activate,
    /** A popup opened over `window`: its current window is that one. Returns the release. */
    popup(contents: WebContents, window: BrowserWindow) {
      track(window)
      popups.set(contents.id, window.id)

      return () => void popups.delete(contents.id)
    },
    /** The tab a popup in `window` is about: the window's active tab. */
    activeTab(window: BrowserWindow) {
      const tab = activeOf(window.id)

      return tab ? snapshot(tab) : undefined
    },
    get(id: number) {
      return tabs.get(id)
    },
    /** Every pane tab's id. */
    ids: () => [...tabs.keys()],
    /** The window that has focus, or had it last. */
    lastWindow() {
      const id = focus.current ?? focus.last
      const win = id === undefined ? undefined : windows.get(id)

      return win && !win.isDestroyed() ? win : undefined
    },
    /** Runs `watch` for every tab, present and future, until its returned release or the tab's removal. */
    watch(watch: (tab: PaneTab) => (() => void) | void) {
      watchers.add(watch)
      const releases = [...tabs.values()].flatMap((tab) => watch(tab) ?? [])

      return () => {
        watchers.delete(watch)
        releases.forEach((release) => release())
      }
    },
  }
}
