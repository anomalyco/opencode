import { createSignal, onCleanup, onMount } from "solid-js"
import "./apps-panel.css"

type Bounds = { x: number; y: number; width: number; height: number }
type AppDockAPI = {
  appDockOpen: (
    url: string,
    bounds: Bounds,
    profile?: string,
  ) => Promise<{ tabID: string; generation: number; url: string }>
  appDockResize: (bounds: Bounds) => Promise<void>
  appDockHide: () => Promise<void>
  appDockClose: () => Promise<void>
  appDockCloseTab: (tabID: string) => Promise<void>
  appDockRecoverTab: (tabID: string) => Promise<{ tabID: string; generation: number; url: string }>
  appDockCloseTabs: (tabID: string, scope: "others" | "right", order?: string[]) => Promise<void>
  appDockSelect: (tabID: string, bounds: Bounds) => Promise<void>
  appDockNavigate: (tabID: string, url: string) => Promise<void>
  appDockCommand: (tabID: string, command: "back" | "forward" | "reload") => Promise<void>
  appDockEvent: (callback: (event: AppDockEvent) => void) => () => void
  appDockFind: (tabID: string, text: string, forward: boolean) => Promise<number>
  appDockStopFind: (tabID: string) => Promise<void>
  appDockFindResult: (
    callback: (result: {
      tabID: string
      generation: number
      requestID: number
      activeMatchOrdinal: number
      matches: number
      finalUpdate: boolean
    }) => void,
  ) => () => void
  appDockZoom: (tabID: string, factor?: number) => Promise<number>
  appDockCancelDownload: (downloadID: string) => Promise<void>
  appDockOpenDownload: (downloadID: string) => Promise<void>
  appDockFullscreen: (tabID: string, enabled: boolean) => Promise<void>
  appDockGetManifest: () => Promise<AppDockManifest>
  appDockUpdateManifest: (expectedRevision: number, manifest: AppDockManifest) => Promise<AppDockManifestUpdate>
}
type AppDockEvent =
  | {
      type: "state"
      payload: {
        tabID: string
        generation: number
        url: string
        title: string
        favicon?: string
        loading: boolean
        audible: boolean
      }
    }
  | { type: "tab-opened"; payload: { tabID: string; generation: number; url: string } }
  | { type: "tab-selected"; payload: TabIdentity }
  | { type: "tab-crashed"; payload: { identity: TabIdentity; reason: "crashed" | "killed" | "oom" } }
  | { type: "tab-recovered"; payload: { tabID: string; generation: number; url: string } }
  | { type: "download"; payload: Download }
  | { type: "permission"; payload: { identity: TabIdentity; permission: string; state: "denied" } }
  | { type: "fullscreen"; payload: { identity: TabIdentity; enabled: boolean } }
  | {
      type: "navigation-error"
      payload: { identity: { tabID: string; generation: number }; code: "blocked" | "failed"; url: string }
    }
type TabIdentity = { tabID: string; generation: number }
type Tab = TabIdentity & {
  url: string
  title?: string
  favicon?: string
  loading?: boolean
  audible?: boolean
  pinned?: boolean
  crashed?: { identity: TabIdentity; reason: "crashed" | "killed" | "oom" }
}
type Profile = { id: string; name: string }
type Bookmark = { url: string; title: string }
type HistoryEntry = Bookmark & { visitedAt: number }
type AppDockManifest = {
  version: 1
  revision: number
  profiles: Profile[]
  activeProfileID: string
  tabs: Record<string, { url: string; pinned: boolean }[]>
  bookmarks: string[]
  history: string[]
}
type AppDockManifestUpdate = { status: "updated" | "conflict"; manifest: AppDockManifest }
type Download = TabIdentity & {
  id: string
  filename: string
  receivedBytes: number
  totalBytes: number
  state: "progressing" | "paused" | "completed" | "cancelled" | "interrupted"
}

const sidebarCollapsedKey = "opencode.app-dock.sidebar-collapsed"
const defaultProfiles: Profile[] = [{ id: "default", name: "Personal" }]

const tabLabel = (tab: Tab) => tab.title || new URL(tab.url).hostname
const sameTab = (left: TabIdentity | undefined, right: TabIdentity | undefined) =>
  !!left && !!right && left.tabID === right.tabID && left.generation === right.generation

const isHTTPS = (url: string) => URL.canParse(url) && new URL(url).protocol === "https:"
const libraryEntries = (urls: string[]): Bookmark[] =>
  urls.filter(isHTTPS).map((url) => ({ url, title: new URL(url).hostname }))

const bounds = (element: HTMLElement): Bounds => {
  const rect = element.getBoundingClientRect()
  // Inactive side-panel tabs can mount at 0x0 before layout settles. Native view
  // needs valid bounds now; ResizeObserver supplies real dimensions afterward.
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  }
}

export function AppsPanel() {
  const [profiles, setProfiles] = createSignal<Profile[]>(defaultProfiles)
  const [profile, setProfile] = createSignal("default")
  const [profileCreating, setProfileCreating] = createSignal(false)
  const [profileDraft, setProfileDraft] = createSignal("")
  const [url, setURL] = createSignal("https://opencode.ai")
  const [tabs, setTabs] = createSignal<Tab[]>([])
  const [active, setActive] = createSignal<TabIdentity>()
  const [error, setError] = createSignal<string>()
  const [navigationError, setNavigationError] = createSignal<{ tabID: string; generation: number; url: string }>()
  const [bookmarks, setBookmarks] = createSignal<Bookmark[]>([])
  const [history, setHistory] = createSignal<HistoryEntry[]>([])
  const [libraryOpen, setLibraryOpen] = createSignal<"bookmarks" | "history">()
  const [findOpen, setFindOpen] = createSignal(false)
  const [findText, setFindText] = createSignal("")
  const [findResult, setFindResult] = createSignal<{ requestID: number; activeMatchOrdinal: number; matches: number }>()
  const [downloads, setDownloads] = createSignal<Download[]>([])
  const [downloadsOpen, setDownloadsOpen] = createSignal(false)
  const [permission, setPermission] = createSignal<{ permission: string; state: "denied" }>()
  const [fullscreen, setFullscreen] = createSignal(false)
  const [recovering, setRecovering] = createSignal<TabIdentity>()
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(localStorage.getItem(sidebarCollapsedKey) === "true")
  const [menu, setMenu] = createSignal<{ tab: Tab; x: number; y: number; invoker: HTMLButtonElement }>()
  let findRequestID: number | undefined
  let root: HTMLDivElement | undefined
  let host: HTMLDivElement | undefined
  let menuElement: HTMLDivElement | undefined
  let addressInput: HTMLInputElement | undefined
  let resizeFrame: number | undefined
  const [switching, setSwitching] = createSignal(false)
  let restoreGeneration = 0
  let disposed = false
  let manifest: AppDockManifest | undefined
  let manifestWrite = Promise.resolve()
  let lastSavedHistoryURL: string | undefined
  let lastSavedTabsKey: string | undefined
  const api = () => window.api as AppDockAPI | undefined
  const capability = (name: keyof AppDockAPI) => typeof api()?.[name] === "function"
  const closeMenu = (restoreFocus = true) => {
    const invoker = menu()?.invoker
    setMenu(undefined)
    if (restoreFocus) requestAnimationFrame(() => invoker?.focus())
  }
  const applyManifest = (next: AppDockManifest) => {
    manifest = next
    lastSavedHistoryURL = next.history[0]
    setProfiles(next.profiles)
    setProfile(next.activeProfileID)
    setBookmarks(libraryEntries(next.bookmarks))
    setHistory(libraryEntries(next.history).map((entry) => ({ ...entry, visitedAt: Date.now() })))
  }
  const updateManifest = (change: (current: AppDockManifest) => AppDockManifest) => {
    const run = async () => {
      const dock = api()
      if (!dock || !manifest) return
      let current = manifest
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await dock.appDockUpdateManifest(current.revision, change(current))
        if (result.status === "updated") {
          applyManifest(result.manifest)
          return result.manifest
        }
        current = await dock.appDockGetManifest()
        applyManifest(current)
      }
      setError("App Dock changed in another window")
    }
    const pending = manifestWrite.then(run, run)
    manifestWrite = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }
  const saveTabs = (items = tabs(), profileID = profile()) => {
    const saved = items.filter((tab) => isHTTPS(tab.url)).map((tab) => ({ url: tab.url, pinned: !!tab.pinned }))
    const key = `${profileID}:${JSON.stringify(saved)}`
    if (key === lastSavedTabsKey) return Promise.resolve(manifest)
    lastSavedTabsKey = key
    return updateManifest((current) => ({
      ...current,
      tabs: { ...current.tabs, [profileID]: saved },
    }))
  }
  const saveHistory = (url: string) => {
    if (!isHTTPS(url) || url === lastSavedHistoryURL) return
    lastSavedHistoryURL = url
    void updateManifest((current) => ({
      ...current,
      history: [url, ...current.history.filter((item) => item !== url)].slice(0, 100),
    }))
  }
  const resize = () => {
    if (resizeFrame !== undefined) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      if (active() && host) void api()?.appDockResize(bounds(host))
    })
  }
  const restoreProfile = async (profileID: string, generation: number, snapshot: AppDockManifest) => {
    const saved = (snapshot.tabs[profileID] ?? []).filter((tab) => isHTTPS(tab.url))
    await api()?.appDockClose()
    setTabs([])
    setActive(undefined)
    setURL("https://opencode.ai")
    const restored: Tab[] = []
    for (const tab of saved) {
      if (disposed || generation !== restoreGeneration) return
      try {
        const opened = await api()?.appDockOpen(tab.url, bounds(host!), profileID)
        if (disposed || generation !== restoreGeneration) {
          if (opened) await api()?.appDockCloseTab(opened.tabID)
          return
        }
        if (opened) restored.push({ ...tab, ...opened })
      } catch {
        // Skip stale or unavailable URLs during startup restore.
      }
    }
    if (disposed || generation !== restoreGeneration) return
    setTabs(restored)
    const first = restored[0]
    if (first) {
      setActive(first)
      setURL(first.url)
      await api()?.appDockSelect(first.tabID, bounds(host!))
    }
  }
  onMount(() => {
    const applyState = (state: Tab & { error?: string }) => {
      const known = tabs().find((tab) => sameTab(tab, state))
      if (!known) return
      const next = tabs().map((tab) => (sameTab(tab, state) ? { ...tab, ...state } : tab))
      setTabs(next)
      if (known.url !== state.url && !switching()) void saveTabs(next)
      if (sameTab(state, active())) setURL(state.url)
      if (sameTab(state, active()) && state.error) setError(state.error)
      const failed = navigationError()
      if (
        sameTab(state, active()) &&
        !state.loading &&
        failed?.tabID === state.tabID &&
        failed.generation === state.generation &&
        failed.url === state.url
      ) {
        setError(undefined)
        setNavigationError(undefined)
      }
      if (!state.error && !state.loading) {
        const entry = { url: state.url, title: state.title || new URL(state.url).hostname, visitedAt: Date.now() }
        setHistory((items) => {
          const next = [entry, ...items.filter((item) => item.url !== entry.url)].slice(0, 100)
          if (!switching()) saveHistory(entry.url)
          return next
        })
      }
    }
    const unsubscribeEvent = api()?.appDockEvent((event) => {
      if (event.type === "state") applyState(event.payload)
      if (event.type === "tab-opened") {
        setFullscreen(false)
        const tab = event.payload
        const next = tabs().some((item) => sameTab(item, tab)) ? tabs() : [...tabs(), tab]
        setTabs(next)
        if (!switching()) void saveTabs(next)
        setActive(tab)
        setURL(tab.url)
      }
      if (event.type === "tab-selected") {
        setFullscreen(false)
        const tab = tabs().find((item) => sameTab(item, event.payload))
        if (tab) {
          setActive(tab)
          setURL(tab.url)
        }
      }
      if (event.type === "tab-crashed") {
        const { identity, reason } = event.payload
        if (!tabs().some((tab) => sameTab(tab, identity))) return
        setTabs((items) =>
          items.map((tab) => (sameTab(tab, identity) ? { ...tab, crashed: { identity, reason } } : tab)),
        )
      } else if (event.type === "tab-recovered") {
        const recovered = event.payload
        const crashed = tabs().find(
          (tab) => tab.tabID === recovered.tabID && tab.crashed && sameTab(tab, tab.crashed.identity),
        )
        if (!crashed) return
        setTabs((items) =>
          items.map((tab) => (sameTab(tab, crashed) ? { ...tab, ...recovered, crashed: undefined } : tab)),
        )
        if (sameTab(crashed, active())) {
          setActive(recovered)
          setURL(recovered.url)
        }
        if (sameTab(recovering(), crashed)) setRecovering(undefined)
      } else if (event.type === "navigation-error") {
        const { tabID, generation } = event.payload.identity
        if (!tabs().some((tab) => sameTab(tab, { tabID, generation }))) return
        if (sameTab({ tabID, generation }, active())) {
          setError(event.payload.code === "blocked" ? "Navigation blocked" : "Navigation failed")
          setNavigationError({ tabID, generation, url: event.payload.url })
        }
      } else if (event.type === "download") {
        if (!tabs().some((tab) => sameTab(tab, event.payload))) return
        setDownloads((items) => [event.payload, ...items.filter((item) => item.id !== event.payload.id)].slice(0, 20))
      } else if (event.type === "permission" && sameTab(event.payload.identity, active())) {
        setPermission({ permission: event.payload.permission, state: event.payload.state })
      } else if (event.type === "fullscreen" && sameTab(event.payload.identity, active())) {
        setFullscreen(event.payload.enabled)
      }
    })
    const unsubscribeFind = api()?.appDockFindResult?.((result) => {
      if (sameTab(result, active()) && result.requestID === findRequestID) setFindResult(result)
    })
    const observer = new ResizeObserver(resize)
    if (host) observer.observe(host)
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!target || !root?.contains(target)) return
      const editable = !!target.closest("input, textarea, select, [contenteditable]")
      if (event.key === "Escape") {
        if (menu()) closeMenu()
        else if (findOpen()) closeFind()
        else if (libraryOpen()) setLibraryOpen(undefined)
        else if (downloadsOpen()) setDownloadsOpen(false)
        else return
        event.preventDefault()
        return
      }
      if (editable) return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === "l") {
        event.preventDefault()
        addressInput?.focus()
        addressInput?.select()
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault()
        void openNewTab()
      } else if (event.key.toLowerCase() === "w" && active()) {
        event.preventDefault()
        void close()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    const insideMenu = (target: EventTarget | null) => target instanceof Node && menuElement?.contains(target)
    const onPointerDown = (event: PointerEvent) => {
      if (menu() && !insideMenu(event.target)) closeMenu(false)
    }
    const onFocusIn = (event: FocusEvent) => {
      if (menu() && !insideMenu(event.target)) closeMenu(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("focusin", onFocusIn)
    void (async () => {
      if (!api()) return
      try {
        const snapshot = await api()!.appDockGetManifest()
        if (disposed) return
        applyManifest(snapshot)
        const generation = ++restoreGeneration
        setSwitching(true)
        await restoreProfile(snapshot.activeProfileID, generation, snapshot)
        if (generation === restoreGeneration) setSwitching(false)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load App Dock")
        setSwitching(false)
      }
    })()
    onCleanup(() => {
      disposed = true
      observer.disconnect()
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("focusin", onFocusIn)
      unsubscribeEvent?.()
      unsubscribeFind?.()
      void api()?.appDockClose()
    })
  })
  const launch = async () => {
    if (!host || !api()) return
    setError(undefined)
    setNavigationError(undefined)
    try {
      const current = active()
      if (current) {
        await api()!.appDockNavigate(current.tabID, url())
        const next = tabs().map((tab) => (sameTab(tab, current) ? { ...tab, url: url() } : tab))
        setTabs(next)
        void saveTabs(next)
        return
      }
      const tab = await api()!.appDockOpen(url(), bounds(host), profile())
      const next = tabs().some((item) => sameTab(item, tab)) ? tabs() : [...tabs(), tab]
      setTabs(next)
      void saveTabs(next)
      setActive(tab)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open App Dock")
    }
  }
  const openNewTab = async () => {
    if (!host || !api()) return
    try {
      const tab = await api()!.appDockOpen("https://opencode.ai", bounds(host), profile())
      const next = tabs().some((item) => sameTab(item, tab)) ? tabs() : [...tabs(), tab]
      setTabs(next)
      void saveTabs(next)
      setActive(tab)
      setURL(tab.url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open App Dock")
    }
  }
  const close = async (requested = active()) => {
    if (!requested) return
    const items = tabs()
    const index = items.findIndex((tab) => sameTab(tab, requested))
    if (index < 0) return
    const next = items[index - 1] ?? items[index + 1]
    await api()?.appDockCloseTab(requested.tabID)
    const remaining = tabs().filter((tab) => !sameTab(tab, requested))
    setTabs(remaining)
    void saveTabs(remaining)
    if (!sameTab(requested, active())) return
    setActive(next)
    setURL(next?.url ?? "https://opencode.ai")
    if (next && host) await api()?.appDockSelect(next.tabID, bounds(host))
  }
  const closeTabs = async (tab: Tab, scope: "others" | "right") => {
    const items = tabs()
    const visual = [...items.filter((item) => item.pinned), ...items.filter((item) => !item.pinned)]
    const index = visual.findIndex((item) => sameTab(item, tab))
    if (index < 0 || (scope === "others" ? items.length < 2 : index === visual.length - 1)) return
    await api()?.appDockCloseTabs(tab.tabID, scope, scope === "right" ? visual.map((item) => item.tabID) : undefined)
    const closed = scope === "others" ? items.filter((item) => !sameTab(item, tab)) : visual.slice(index + 1)
    const remaining = items.filter((candidate) => !closed.some((closedTab) => sameTab(candidate, closedTab)))
    setTabs(remaining)
    void saveTabs(remaining)
    if (!remaining.some((item) => sameTab(item, active()))) {
      const next = remaining.find((candidate) => sameTab(candidate, tab)) ?? remaining.at(-1)
      setActive(next)
      setURL(next?.url ?? "https://opencode.ai")
      if (next && host) await api()?.appDockSelect(next.tabID, bounds(host))
    }
  }
  const selectTab = (tab: Tab) => {
    setActive(tab)
    setURL(tab.url)
    if (!tab.crashed && host) void api()?.appDockSelect(tab.tabID, bounds(host))
  }
  const duplicateTab = async (tab: Tab) => {
    if (!host || !capability("appDockOpen")) return
    try {
      const copy = await api()!.appDockOpen(tab.url, bounds(host), profile())
      const next = tabs().some((item) => sameTab(item, copy)) ? tabs() : [...tabs(), copy]
      setTabs(next)
      void saveTabs(next)
      selectTab(copy)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not duplicate tab")
    }
  }
  const toggleSidebar = () => {
    const next = !sidebarCollapsed()
    setSidebarCollapsed(next)
    localStorage.setItem(sidebarCollapsedKey, String(next))
  }
  const createProfile = (event: SubmitEvent) => {
    event.preventDefault()
    const name = profileDraft().trim()
    if (!name) return
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32)
    if (!id || profiles().some((item) => item.id === id)) return
    void updateManifest((current) => ({
      ...current,
      profiles: [...current.profiles, { id, name }],
      tabs: { ...current.tabs, [id]: [] },
    }))
    setProfileDraft("")
    setProfileCreating(false)
  }
  const switchProfile = (next: string) => {
    if (next === profile() || switching()) return
    setSwitching(true)
    const generation = ++restoreGeneration
    setLibraryOpen(undefined)
    void (async () => {
      try {
        const snapshot = await updateManifest((current) => ({ ...current, activeProfileID: next }))
        if (!snapshot || disposed || generation !== restoreGeneration) return
        setProfile(snapshot.activeProfileID)
        await restoreProfile(snapshot.activeProfileID, generation, snapshot)
      } catch (cause) {
        if (!disposed && generation === restoreGeneration) setError(cause instanceof Error ? cause.message : "Could not switch App Dock profile")
      } finally {
        if (generation === restoreGeneration) setSwitching(false)
      }
    })()
  }
  const activeTab = () => tabs().find((tab) => sameTab(tab, active()))
  const activeCrashed = () => activeTab()?.crashed
  const recover = async () => {
    const tab = activeTab()
    if (!tab?.crashed || !capability("appDockRecoverTab") || recovering()) return
    setRecovering(tab)
    try {
      await api()!.appDockRecoverTab(tab.tabID)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not recover tab")
    } finally {
      setRecovering(undefined)
    }
  }
  const bookmarked = () => !!activeTab() && bookmarks().some((item) => item.url === activeTab()!.url)
  const toggleBookmark = () => {
    const tab = activeTab()
    if (!tab) return
    const current = bookmarks()
    const next = current.some((item) => item.url === tab.url)
      ? current.filter((item) => item.url !== tab.url)
      : [{ url: tab.url, title: tabLabel(tab) }, ...current]
    setBookmarks(next)
    void updateManifest((current) => ({ ...current, bookmarks: next.map((item) => item.url) }))
  }
  const find = async (forward: boolean) => {
    const tab = active()
    if (!tab || !findText().trim()) return
    setFindResult(undefined)
    findRequestID = await api()?.appDockFind(tab.tabID, findText(), forward)
  }
  const closeFind = () => {
    const tab = active()
    if (tab) void api()?.appDockStopFind(tab.tabID)
    findRequestID = undefined
    setFindOpen(false)
    setFindResult(undefined)
  }
  const zoom = (delta: number) => {
    const tab = active()
    if (!tab) return
    void api()
      ?.appDockZoom(tab.tabID)
      .then((factor) => api()?.appDockZoom(tab.tabID, factor + delta))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not change zoom"))
  }
  const toggleFullscreen = () => {
    const tab = active()
    if (tab)
      void api()
        ?.appDockFullscreen(tab.tabID, !fullscreen())
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not change fullscreen"))
  }
  const openLibraryItem = async (entry: Bookmark) => {
    setLibraryOpen(undefined)
    setURL(entry.url)
    if (!host || !api()) return
    const tab = await api()!.appDockOpen(entry.url, bounds(host), profile())
    const next = tabs().some((item) => sameTab(item, tab)) ? tabs() : [...tabs(), tab]
    setTabs(next)
    void saveTabs(next)
    setActive(tab)
  }
  return (
    <div ref={root} class={`zen-browser-shell ${sidebarCollapsed() ? "is-sidebar-collapsed" : ""}`}>
      <aside class="zen-browser-sidebar" aria-label="Browser workspaces">
        <div class="zen-workspace-indicator" aria-label="Current workspace">
          <button
            class="zen-sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed() ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={sidebarCollapsed()}
            onClick={toggleSidebar}
          >
            ||
          </button>
          <span class="zen-workspace-indicator-dot" aria-hidden="true" />
          <select
            class="zen-workspace-indicator-name"
            value={profile()}
            aria-label="Browser profile"
            disabled={switching()}
            onChange={(event) => switchProfile(event.currentTarget.value)}
          >
            {profiles().map((item) => (
              <option value={item.id}>{item.name}</option>
            ))}
          </select>
          <button
            class="zen-profile-add"
            type="button"
            aria-label="Create browser profile"
            onClick={() => setProfileCreating(true)}
          >
            +
          </button>
        </div>
        {profileCreating() && (
          <form class="zen-profile-form" onSubmit={createProfile}>
            <input
              autofocus
              value={profileDraft()}
              onInput={(event) => setProfileDraft(event.currentTarget.value)}
              placeholder="Profile name"
              aria-label="New profile name"
            />
            <button type="submit" aria-label="Save profile">
              +
            </button>
            <button type="button" aria-label="Cancel profile creation" onClick={() => setProfileCreating(false)}>
              x
            </button>
          </form>
        )}
        <div class="zen-tabs" role="tablist" aria-label="Tabs">
          {tabs().filter((tab) => tab.pinned).length > 0 && <div class="zen-tab-section-label">Pinned</div>}
          {tabs()
            .filter((tab) => tab.pinned)
            .map((tab) => (
              <TabButton tab={tab} active={active} select={selectTab} setMenu={setMenu} />
            ))}
          {tabs()
            .filter((tab) => !tab.pinned)
            .map((tab) => (
              <TabButton tab={tab} active={active} select={selectTab} setMenu={setMenu} />
            ))}
          <button class="zen-new-tab" type="button" onClick={() => void openNewTab()}>
            + New tab
          </button>
        </div>
      </aside>
      <main class="zen-browser-content">
        <form
          class="zen-urlbar"
          onSubmit={(event) => {
            event.preventDefault()
            void launch()
          }}
        >
          <button
            class="zen-nav-button"
            type="button"
            aria-label="Back"
            disabled={!active() || !!activeCrashed() || !capability("appDockCommand")}
            onClick={() => {
              const tab = active()
              if (tab) void api()?.appDockCommand(tab.tabID, "back")
            }}
          >
            &#8592;
          </button>
          <button
            class="zen-nav-button"
            type="button"
            aria-label="Forward"
            disabled={!active() || !!activeCrashed() || !capability("appDockCommand")}
            onClick={() => {
              const tab = active()
              if (tab) void api()?.appDockCommand(tab.tabID, "forward")
            }}
          >
            &#8594;
          </button>
          <button
            class={`zen-nav-button ${bookmarked() ? "is-active" : ""}`}
            type="button"
            aria-label={bookmarked() ? "Remove bookmark" : "Add bookmark"}
            disabled={!!activeCrashed()}
            onClick={toggleBookmark}
          >
            &#9733;
          </button>
          <input
            ref={addressInput}
            value={url()}
            onInput={(event) => setURL(event.currentTarget.value)}
            aria-label="Address"
            disabled={!!activeCrashed()}
          />
          <button
            class="zen-nav-button"
            type="button"
            aria-label="Bookmarks"
            onClick={() => setLibraryOpen(libraryOpen() === "bookmarks" ? undefined : "bookmarks")}
          >
            &#9734;
          </button>
          <button
            class="zen-nav-button"
            type="button"
            aria-label="History"
            onClick={() => setLibraryOpen(libraryOpen() === "history" ? undefined : "history")}
          >
            &#8986;
          </button>
          <button
            class="zen-nav-button"
            type="button"
            aria-label="Find in page"
            disabled={!!activeCrashed()}
            onClick={() => setFindOpen(true)}
          >
            &#8981;
          </button>
          <button
            class="zen-nav-button"
            type="button"
            aria-label="Zoom out"
            disabled={!!activeCrashed()}
            onClick={() => zoom(-0.1)}
          >
            A-
          </button>
          <button
            class="zen-nav-button"
            type="button"
            aria-label="Zoom in"
            disabled={!!activeCrashed()}
            onClick={() => zoom(0.1)}
          >
            A+
          </button>
          <button
            class="zen-nav-button"
            type="button"
            aria-label="Downloads"
            onClick={() => setDownloadsOpen(!downloadsOpen())}
          >
            &#8595;
          </button>
          <button
            class="zen-nav-button"
            type="button"
            aria-label={fullscreen() ? "Exit fullscreen" : "Enter fullscreen"}
            disabled={!!activeCrashed()}
            onClick={toggleFullscreen}
          >
            {fullscreen() ? "Exit" : "Full"}
          </button>
          <button
            class="zen-open-button"
            type="button"
            disabled={!active() || !!activeCrashed() || !capability("appDockCommand")}
            onClick={() => {
              const tab = active()
              if (tab) void api()?.appDockCommand(tab.tabID, "reload")
            }}
          >
            {activeTab()?.loading ? "Loading" : "Reload"}
          </button>
          <button class="zen-open-button" type="submit" disabled={!api() || !!activeCrashed()}>
            {activeTab()?.loading ? "Loading" : "Open"}
          </button>
          {active() && (
            <button class="zen-nav-button" type="button" onClick={() => void close()} aria-label="Close tab">
              x
            </button>
          )}
        </form>
        {error() && (
          <div class="zen-error" role="alert" aria-live="assertive">
            {error()}
          </div>
        )}
        {permission() && (
          <div class="zen-error" role="status" aria-live="polite">
            {`${permission()!.permission} permission ${permission()!.state}`}
          </div>
        )}
        {activeCrashed() && (
          <div class="zen-tab-crash" role="alert" aria-live="assertive">
            <span>Tab crashed ({activeCrashed()!.reason}).</span>
            <button
              type="button"
              disabled={!capability("appDockRecoverTab") || !!recovering()}
              onClick={() => void recover()}
            >
              {recovering() ? "Recovering" : "Recover"}
            </button>
          </div>
        )}
        {libraryOpen() && (
          <div class="zen-library" role="dialog" aria-label={libraryOpen() === "bookmarks" ? "Bookmarks" : "History"}>
            <div class="zen-library-title">{libraryOpen() === "bookmarks" ? "Bookmarks" : "History"}</div>
            {(libraryOpen() === "bookmarks" ? bookmarks() : history()).map((entry) => (
              <button type="button" onClick={() => void openLibraryItem(entry)}>
                <span>{entry.title}</span>
                <small>{new URL(entry.url).hostname}</small>
              </button>
            ))}
            {(libraryOpen() === "bookmarks" ? bookmarks() : history()).length === 0 && <p>Nothing here yet.</p>}
          </div>
        )}
        {findOpen() && (
          <form
            class="zen-findbar"
            onSubmit={(event) => {
              event.preventDefault()
              void find(true)
            }}
          >
            <input
              autofocus
              value={findText()}
              onInput={(event) => setFindText(event.currentTarget.value)}
              aria-label="Find in page"
              placeholder="Find in page"
            />
            <span>{findResult() ? `${findResult()!.activeMatchOrdinal}/${findResult()!.matches}` : ""}</span>
            <button type="button" aria-label="Previous match" onClick={() => void find(false)}>
              &#8593;
            </button>
            <button type="submit" aria-label="Next match">
              &#8595;
            </button>
            <button type="button" aria-label="Close find" onClick={closeFind}>
              x
            </button>
          </form>
        )}
        {downloadsOpen() && (
          <div class="zen-library" role="dialog" aria-label="Downloads">
            <div class="zen-library-title">Downloads</div>
            {downloads().map((download) => (
              <div class="zen-download">
                <span>{download.filename}</span>
                <small>
                  {download.state === "progressing" && download.totalBytes > 0
                    ? `${Math.round((download.receivedBytes / download.totalBytes) * 100)}%`
                    : download.state}
                </small>
                {download.state === "completed" ? (
                  <button type="button" onClick={() => void api()?.appDockOpenDownload(download.id)}>
                    Open
                  </button>
                ) : download.state === "progressing" || download.state === "paused" ? (
                  <button type="button" onClick={() => void api()?.appDockCancelDownload(download.id)}>
                    Cancel
                  </button>
                ) : null}
              </div>
            ))}
            {downloads().length === 0 && <p>No downloads yet.</p>}
          </div>
        )}
        {!api() && (
          <div class="zen-empty-state">
            <strong>Browser needs OpenCode Desktop.</strong>
            <span>Native browser tabs are unavailable in web app.</span>
          </div>
        )}
        <div ref={host} class="zen-browser-host" />
        {menu() && (
          <TabMenu
            tab={menu()!.tab}
            x={menu()!.x}
            y={menu()!.y}
            setElement={(element) => (menuElement = element)}
            canDuplicate={capability("appDockOpen") && !menu()!.tab.crashed}
            canReload={capability("appDockCommand") && !menu()!.tab.crashed}
            canClose={capability("appDockCloseTab")}
            hasOthers={tabs().length > 1}
            hasRight={
              [...tabs().filter((item) => item.pinned), ...tabs().filter((item) => !item.pinned)].findIndex((item) =>
                sameTab(item, menu()!.tab),
              ) <
              tabs().length - 1
            }
            onDuplicate={() => {
              void duplicateTab(menu()!.tab)
              closeMenu()
            }}
            onTogglePin={() => {
              const tab = menu()!.tab
              const next = tabs().map((item) => (sameTab(item, tab) ? { ...item, pinned: !item.pinned } : item))
              setTabs(next)
              void saveTabs(next)
              closeMenu()
            }}
            onReload={() => {
              const tab = menu()!.tab
              void api()?.appDockCommand(tab.tabID, "reload")
              closeMenu()
            }}
            onClose={() => {
              void close(menu()!.tab)
              closeMenu()
            }}
            onCloseOthers={() => {
              void closeTabs(menu()!.tab, "others")
              closeMenu()
            }}
            onCloseRight={() => {
              void closeTabs(menu()!.tab, "right")
              closeMenu()
            }}
          />
        )}
      </main>
    </div>
  )
}

function TabButton(props: {
  tab: Tab
  active: () => TabIdentity | undefined
  select: (tab: Tab) => void
  setMenu: (menu: { tab: Tab; x: number; y: number; invoker: HTMLButtonElement }) => void
}) {
  const openMenu = (x: number, y: number, invoker: HTMLButtonElement) =>
    props.setMenu({ tab: props.tab, x, y, invoker })
  const keydown = (event: KeyboardEvent) => {
    const current = event.currentTarget
    if (!(current instanceof HTMLButtonElement)) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      props.select(props.tab)
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault()
      const rect = current.getBoundingClientRect()
      openMenu(rect.left + 8, rect.bottom + 4, current)
    } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = [...(current.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [])]
      const index = tabs.indexOf(current)
      if (index < 0) return
      const next =
        event.key === "Home"
          ? tabs[0]
          : event.key === "End"
            ? tabs.at(-1)
            : tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]
      event.preventDefault()
      next?.focus()
      next?.click()
    }
  }
  return (
    <button
      class={`zen-tab ${sameTab(props.active(), props.tab) ? "is-active" : ""}`}
      type="button"
      role="tab"
      tabindex={sameTab(props.active(), props.tab) ? 0 : -1}
      aria-selected={sameTab(props.active(), props.tab)}
      onClick={() => props.select(props.tab)}
      onContextMenu={(event) => {
        event.preventDefault()
        openMenu(event.clientX, event.clientY, event.currentTarget)
      }}
      onKeyDown={keydown}
    >
      <span class={`zen-tab-icon ${props.tab.loading ? "is-loading" : ""}`}>
        {props.tab.favicon ? (
          <img src={props.tab.favicon} alt="" />
        ) : (
          new URL(props.tab.url).hostname.slice(0, 1).toUpperCase()
        )}
      </span>
      <span class="zen-tab-title">{tabLabel(props.tab)}</span>
      {props.tab.pinned ? "Pinned" : ""}
      {props.tab.audible && <span class="zen-tab-audio">&#9835;</span>}
    </button>
  )
}

function TabMenu(props: {
  tab: Tab
  x: number
  y: number
  setElement: (element: HTMLDivElement) => void
  canDuplicate: boolean
  canReload: boolean
  canClose: boolean
  hasOthers: boolean
  hasRight: boolean
  onDuplicate: () => void
  onTogglePin: () => void
  onReload: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseRight: () => void
}) {
  let firstItem: HTMLButtonElement | undefined
  return (
    <div
      ref={props.setElement}
      class="zen-tab-menu"
      role="menu"
      aria-label={`Actions for ${tabLabel(props.tab)}`}
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
    >
      <button
        ref={(element) => {
          firstItem = element
          requestAnimationFrame(() => firstItem?.focus())
        }}
        type="button"
        role="menuitem"
        disabled={!props.canDuplicate}
        onClick={props.onDuplicate}
      >
        Duplicate
      </button>
      <button type="button" role="menuitem" onClick={props.onTogglePin}>
        {props.tab.pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" role="menuitem" disabled={!props.canReload} onClick={props.onReload}>
        Reload
      </button>
      <button type="button" role="menuitem" disabled={!props.canClose} onClick={props.onClose}>
        Close
      </button>
      <button type="button" role="menuitem" disabled={!props.hasOthers} onClick={props.onCloseOthers}>
        Close others
      </button>
      <button type="button" role="menuitem" disabled={!props.hasRight} onClick={props.onCloseRight}>
        Close right
      </button>
    </div>
  )
}
