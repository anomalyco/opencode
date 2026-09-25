import { app, session, shell, WebContentsView } from "electron"
import type { BrowserWindow, Session } from "electron"
import { createHash, randomUUID } from "node:crypto"
import type { EventEmitter } from "node:events"
import { appDockURL, appDockZoom, panelBoundsToContent, type DockBounds } from "./app-dock-utils"
export type { DockBounds } from "./app-dock-utils"
import { buildScrollScript, buildHoverScript, buildDragScript, buildClickAtProbeScript, buildClickScript, buildElementPointScript, buildFocusScript, buildReadElementScript, buildSnapshotScript, buildTypeScript, buildScrollToScript, buildStorageScript, buildPDFSript, buildFrameScript, buildRetryScript, buildEvaluateScript, buildNetworkScript } from "./app-dock-browser"
import type { AppDockAPI } from "./app-dock-api"

export type AppDockIdentity = Readonly<{ tabID: string; generation: number }>
export type AppDockTab = AppDockIdentity & { url: string }
export type ProfileStorage = Readonly<{ storageKey: string }>

const appDockKeyCode = (key: string) => {
  const aliases: Record<string, string> = {
    Escape: "ESC",
    Esc: "ESC",
    Space: "SPACE",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    Backspace: "BACKSPACE",
    Delete: "DELETE",
    Enter: "ENTER",
    Tab: "TAB",
  }
  return aliases[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

export type AppDockState = AppDockIdentity & {
  url: string
  title: string
  favicon?: string
  loading: boolean
  audible: boolean
}
export type AppDockFindResult = AppDockIdentity & {
  requestID: number
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}
export type AppDockDownload = AppDockIdentity & {
  id: string
  filename: string
  receivedBytes: number
  totalBytes: number
  state: "progressing" | "paused" | "completed" | "cancelled" | "interrupted"
}
export type AppDockEvent =
  | Readonly<{ type: "state"; payload: AppDockState }>
  | Readonly<{ type: "tab-opened"; payload: AppDockTab }>
  | Readonly<{ type: "tab-selected"; payload: AppDockIdentity }>
  | Readonly<{
      type: "tab-crashed"
      payload: { identity: AppDockIdentity; reason: "crashed" | "killed" | "oom" }
    }>
  | Readonly<{ type: "tab-recovered"; payload: AppDockTab }>
  | Readonly<{ type: "download"; payload: AppDockDownload }>
  | Readonly<{
      type: "permission"
      payload: { identity: AppDockIdentity; permission: string; state: "denied" }
    }>
  | Readonly<{ type: "fullscreen"; payload: { identity: AppDockIdentity; enabled: boolean } }>
  | Readonly<{
      type: "navigation-error"
      payload: { identity: AppDockIdentity; code: "blocked" | "failed"; url: string }
    }>
type AppDockRecord = {
  view: WebContentsView
  win: BrowserWindow
  storageKey: string
  generation: number
  state: () => AppDockState
  notify: (event: AppDockEvent) => void
  cleanups: (() => void)[]
}

const storagePartition = (storageKey: string) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(storageKey)) throw new Error("Invalid App Dock storage key")
  return `persist:app-dock-${storageKey}`
}

export { panelBoundsToContent }

export type AppDock = AppDockAPI

export function createAppDock(options: { developmentMode?: () => boolean } = {}): AppDockAPI {
  const developmentMode = options.developmentMode ?? (() => !app.isPackaged)
  const browserSessions = new Map<string, Session>()
  const configuredPartitions = new Set<string>()
  const retiredStorageKeys = new Set<string>()
  const tabs = new Map<number, Map<string, AppDockRecord>>()
  const readQueues = new Map<string, Promise<unknown>>()
  const navigationQueues = new Map<string, Promise<unknown>>()
  const refTargets = new Map<string, Map<number, { x: number; y: number; width: number; height: number; tag: string; name: string; href?: string; url: string }>>()
  const blockedNavigationVersions = new Map<string, number>()
  const fullscreenOwner = new Map<number, string>()
  const fullscreenEpoch = new Map<number, number>()
  const fullscreenWindowListeners = new Map<number, () => void>()
  const tabByContents = new Map<number, { senderID: number; tabID: string; generation: number }>()
  const downloads = new Map<
    string,
    { senderID: number; storageKey: string; item: Electron.DownloadItem; state: AppDockDownload }
  >()
  const terminalDownloads = new Map<string, number>()
  const active = new Map<number, string>()
      const layoutBounds = new Map<number, DockBounds>()
  let lastLayoutBounds: DockBounds | undefined
  const inactive = new Map<string, { senderID: number; tabID: string }>()
  const refNamespaces = new Map<string, number>()
  const committedNavigations = new Set<string>()
  let generation = 0
  let refNamespace = 0
  const MAX_INACTIVE_TABS = 20
  const APP_DOCK_EXECUTION_TIMEOUT_MS = 10_000
  const MAX_PROGRESSING_DOWNLOADS_PER_PROFILE = 8
  const MAX_TERMINAL_DOWNLOADS_PER_SENDER = 20

  const validBounds = (bounds: DockBounds) =>
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) && bounds.width > 0 && bounds.height > 0
  const usableBounds = (bounds: DockBounds) => validBounds(bounds) && bounds.width > 1 && bounds.height > 1
  const identity = (tabID: string, tabGeneration: number): AppDockIdentity =>
    Object.freeze({ tabID, generation: tabGeneration })
  const isCurrent = (senderID: number, tabID: string, tabGeneration: number) =>
    tabs.get(senderID)?.get(tabID)?.generation === tabGeneration
  const markInactive = (senderID: number, tabID: string, record: AppDockRecord) => {
    record.view.webContents.setBackgroundThrottling(true)
    inactive.delete(`${senderID}:${tabID}`)
    inactive.set(`${senderID}:${tabID}`, { senderID, tabID })
  }
  const remove = (senderID: number, tabID: string) => {
    const record = tabs.get(senderID)?.get(tabID)
    if (!record) return
    refTargets.delete(`${senderID}:${tabID}`)
    blockedNavigationVersions.delete(`${senderID}:${tabID}`)
    refNamespaces.delete(`${senderID}:${tabID}`)
    committedNavigations.delete(`${senderID}:${tabID}`)
    if (fullscreenOwner.get(senderID) === tabID) {
      fullscreenOwner.delete(senderID)
      fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
      void record.view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
      if (!record.win.isDestroyed() && record.win.isFullScreen()) record.win.setFullScreen(false)
    }
    if (!record.win.isDestroyed()) record.win.contentView.removeChildView(record.view)
    inactive.delete(`${senderID}:${tabID}`)
    tabByContents.delete(record.view.webContents.id)
    record.cleanups.forEach((cleanup) => cleanup())
    for (const [downloadID, download] of downloads) {
      if (
        download.senderID === senderID &&
        download.state.tabID === tabID &&
        download.state.generation === record.generation
      ) {
        download.item.cancel()
        downloads.delete(downloadID)
        terminalDownloads.delete(downloadID)
      }
    }
    record.view.webContents.close()
    tabs.get(senderID)?.delete(tabID)
    generation++
    if (active.get(senderID) === tabID) active.delete(senderID)
  }
  const installFullscreenWindowBridge = (senderID: number, win: BrowserWindow) => {
    if (fullscreenWindowListeners.has(senderID)) return
    const listener = () => {
      const tabID = fullscreenOwner.get(senderID)
      const record = tabID && tabs.get(senderID)?.get(tabID)
      if (!record || win.isDestroyed()) return
      const epoch = (fullscreenEpoch.get(senderID) ?? 0) + 1
      fullscreenEpoch.set(senderID, epoch)
      void record.view.webContents
        .executeJavaScript("Boolean(document.fullscreenElement)", true)
        .then((documentFullscreen) => {
          if (fullscreenEpoch.get(senderID) !== epoch || !isCurrent(senderID, tabID, record.generation)) return
          if (!documentFullscreen) {
            if (fullscreenOwner.get(senderID) === tabID) {
              fullscreenOwner.delete(senderID)
              fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
            }
            record.notify(Object.freeze({ type: "fullscreen", payload: Object.freeze({ identity: identity(tabID, record.generation), enabled: false }) }))
            return
          }
          if (!win.isFullScreen()) win.setFullScreen(true)
          if (fullscreenEpoch.get(senderID) !== epoch) return
          void record.view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true)
        })
        .catch(() => undefined)
    }
    win.on("leave-full-screen", listener)
    fullscreenWindowListeners.set(senderID, listener)
  }
  const clearSender = (senderID: number, win?: BrowserWindow) => {
    const listener = fullscreenWindowListeners.get(senderID)
    if (listener && win && !win.isDestroyed()) win.removeListener("leave-full-screen", listener)
    fullscreenWindowListeners.delete(senderID)
    fullscreenEpoch.delete(senderID)
    active.delete(senderID)
    layoutBounds.delete(senderID)
  }
  const close = (senderID: number, win?: BrowserWindow, tabID?: string) => {
    const senderTabs = tabs.get(senderID)
    if (!senderTabs) return
    let ids: string[]
    if (tabID) ids = [tabID]
    else {
      const activeTabID = active.get(senderID)
      ids = activeTabID ? [activeTabID] : []
    }
    const closingActive = ids.some((id) => active.get(senderID) === id)
    const closedIndex = [...senderTabs.keys()].indexOf(ids[0]!)
    ids.forEach((id) => remove(senderID, id))
    const remaining = tabs.get(senderID)
    if (!remaining || remaining.size === 0) {
      tabs.delete(senderID)
      clearSender(senderID, win)
      return
    }
    if (closingActive && !active.has(senderID)) {
      const remainingIDs = [...remaining.keys()]
      const nextTabID = remainingIDs[Math.max(0, Math.min(closedIndex - 1, remainingIDs.length - 1))]
      const next = nextTabID ? remaining.get(nextTabID) : undefined
      if (nextTabID && next) {
        if (win && !win.isDestroyed()) {
          win.contentView.addChildView(next.view)
          next.view.setBounds(layoutBounds.get(senderID) ?? next.view.getBounds())
          next.view.setVisible(true)
          next.view.webContents.setBackgroundThrottling(false)
        }
        inactive.delete(`${senderID}:${nextTabID}`)
        active.set(senderID, nextTabID)
        next.notify(Object.freeze({ type: "tab-selected", payload: identity(nextTabID, next.generation) }))
      }
    }
  }
  const closeAll = (senderID: number, win: BrowserWindow) => {
    const senderTabs = tabs.get(senderID)
    if (!senderTabs) return
    ;[...senderTabs.keys()].forEach((tabID) => remove(senderID, tabID))
    tabs.delete(senderID)
    clearSender(senderID, win)
  }
  const evictOldestInactive = (senderID?: number) => {
    for (const oldest of inactive.values()) {
      if (senderID === undefined || oldest.senderID === senderID) {
        remove(oldest.senderID, oldest.tabID)
        return true
      }
    }
    return false
  }
  const ensureViewCapacity = (senderID: number, selected: boolean) => {
    const inactiveNeeded = selected ? Number(active.has(senderID)) : 1
    while (inactive.size + inactiveNeeded > MAX_INACTIVE_TABS) {
      if (!evictOldestInactive()) throw new Error("App Dock tab limit reached")
    }
  }
  const open = async (
    senderID: number,
    win: BrowserWindow,
    address: string,
    bounds: DockBounds,
    notify: (event: AppDockEvent) => void,
    profileStorage: ProfileStorage,
    replacement?: Readonly<{ tabID: string; selected: boolean }>,
  ): Promise<AppDockTab> => {
    if (!validBounds(bounds)) throw new Error("Invalid App Dock bounds")
    const id = replacement?.tabID ?? randomUUID()
    const tabGeneration = ++generation
    refNamespaces.set(`${senderID}:${id}`, ++refNamespace)
    let target: string
    try {
      target = appDockURL(address)
    } catch {
      const tabIdentity = identity(id, tabGeneration)
      notify(
        Object.freeze({
          type: "navigation-error",
          payload: Object.freeze({ identity: tabIdentity, code: "blocked", url: address }),
        }),
      )
      throw new Error("App Dock only supports HTTPS URLs")
    }
    const { storageKey } = profileStorage
    if (retiredStorageKeys.has(storageKey)) throw new Error("App Dock storage key is retired")
    const partition = storagePartition(storageKey)
    const browserSession = browserSessions.get(partition) ?? session.fromPartition(partition)
    browserSessions.set(partition, browserSession)
    if (!configuredPartitions.has(partition)) {
      const denyPermission = (webContents: Electron.WebContents, permission: string) => {
        const source = tabByContents.get(webContents.id)
        const record = source && tabs.get(source.senderID)?.get(source.tabID)
        if (!source || !record || record.generation !== source.generation) return
        record.notify(
          Object.freeze({
            type: "permission",
            payload: Object.freeze({
              identity: identity(source.tabID, source.generation),
              permission,
              state: "denied",
            }),
          }),
        )
      }
      browserSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === "fullscreen") return callback(true)
        if (webContents) denyPermission(webContents, permission)
        callback(false)
      })
      browserSession.setPermissionCheckHandler((webContents, permission) => {
        if (permission === "fullscreen") return true
        if (webContents) denyPermission(webContents, permission)
        return false
      })
      browserSession.on("will-download", (_event, item, webContents) => {
        const source = tabByContents.get(webContents.id)
        const record = source && tabs.get(source.senderID)?.get(source.tabID)
        if (!source || !record || record.generation !== source.generation) return item.cancel()
        const id = randomUUID()
        let rejected = false
        const rejectDownload = () => {
          if (rejected) return
          rejected = true
          item.cancel()
          record.notify(
            Object.freeze({
              type: "navigation-error",
              payload: Object.freeze({
                identity: identity(source.tabID, source.generation),
                code: "failed",
                url: record.state().url,
              }),
            }),
          )
        }
        const updateDownload = (state: AppDockDownload["state"]) => {
          if (rejected || !isCurrent(source.senderID, source.tabID, source.generation)) return
          if (
            state === "progressing" &&
            [...downloads.values()].filter(
              (download) => download.storageKey === record.storageKey && download.state.state === "progressing",
            ).length >= MAX_PROGRESSING_DOWNLOADS_PER_PROFILE
          ) {
            rejectDownload()
            return
          }
          const download = Object.freeze({
            ...identity(source.tabID, source.generation),
            id,
            filename: item.getFilename(),
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
            state,
          })
          downloads.set(id, { senderID: source.senderID, storageKey: record.storageKey, item, state: download })
          if (state === "completed" || state === "cancelled" || state === "interrupted") {
            terminalDownloads.delete(id)
            terminalDownloads.set(id, source.senderID)
            while (
              [...terminalDownloads.values()].filter((id) => id === source.senderID).length >
              MAX_TERMINAL_DOWNLOADS_PER_SENDER
            ) {
              const oldest = [...terminalDownloads].find(([, owner]) => owner === source.senderID)
              if (!oldest) break
              terminalDownloads.delete(oldest[0])
              downloads.delete(oldest[0])
            }
          } else terminalDownloads.delete(id)
          record.notify(Object.freeze({ type: "download", payload: download }))
        }
        item.on("updated", () => updateDownload(item.isPaused() ? "paused" : "progressing"))
        item.once("done", (_doneEvent, state) =>
          updateDownload(state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted"),
        )
        updateDownload("progressing")
      })
      configuredPartitions.add(partition)
    }
    ensureViewCapacity(senderID, replacement?.selected ?? true)
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: browserSession,
        backgroundThrottling: true,
      },
    })
    let state: Omit<AppDockState, "tabID" | "generation"> = {
      url: target,
      title: target,
      loading: true,
      audible: false,
    }
    const snapshot = (): AppDockState => Object.freeze({ ...identity(id, tabGeneration), ...state })
    const update = (patch: Partial<Omit<AppDockState, "tabID" | "generation">>) => {
      if (!isCurrent(senderID, id, tabGeneration)) return
      state = { ...state, ...patch }
      notify(Object.freeze({ type: "state", payload: snapshot() }))
    }
    const cleanups: (() => void)[] = []
    const contents = view.webContents as unknown as EventEmitter
    const listen = (event: string, listener: (...args: any[]) => void) => {
      contents.on(event, listener)
      cleanups.push(() => contents.removeListener(event, listener))
    }
    listen("page-title-updated", (_event, title) => update({ title }))
    listen("page-favicon-updated", (_event, favicons) => update({ favicon: favicons[0] }))
    listen("did-start-loading", () => update({ loading: true }))
    listen("did-stop-loading", () => update({ loading: false, url: view.webContents.getURL() || target }))
    listen("did-fail-load", (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      update({ loading: false, url: validatedURL || state.url })
      if (!isCurrent(senderID, id, tabGeneration)) return
      notify(
        Object.freeze({
          type: "navigation-error",
          payload: Object.freeze({
            identity: identity(id, tabGeneration),
            code: "failed",
            url: validatedURL || state.url,
          }),
        }),
      )
    })
    listen("did-navigate", (_event, navigatedURL) => {
      const key = `${senderID}:${id}`
      refTargets.delete(key)
      if (committedNavigations.has(key)) refNamespaces.set(key, ++refNamespace)
      else committedNavigations.add(key)
      update({ url: navigatedURL })
    })
    listen("did-navigate-in-page", (_event, navigatedURL) => {
      const key = `${senderID}:${id}`
      refTargets.delete(key)
      if (committedNavigations.has(key)) refNamespaces.set(key, ++refNamespace)
      else committedNavigations.add(key)
      update({ url: navigatedURL })
    })
    let crashed = false
    const reportCrash = (reason: "crashed" | "killed" | "oom") => {
      if (crashed || !isCurrent(senderID, id, tabGeneration)) return
      crashed = true
      notify(
        Object.freeze({
          type: "tab-crashed",
          payload: Object.freeze({ identity: identity(id, tabGeneration), reason }),
        }),
      )
    }
    listen("render-process-gone", (_event, details) =>
      reportCrash(details.reason === "killed" ? "killed" : details.reason === "oom" ? "oom" : "crashed"),
    )
    listen("crashed", (_event, killed) => reportCrash(killed ? "killed" : "crashed"))
    listen("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return
      if (input.key === "F12" || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i"))
        event.preventDefault()
    })
    listen("devtools-opened", () => {
      if (!developmentMode()) view.webContents.closeDevTools()
    })
    listen("media-started-playing", () => update({ audible: true }))
    listen("media-paused", () => update({ audible: false }))
    view.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const popupURL = appDockURL(url)
        void open(senderID, win, popupURL, bounds, notify, profileStorage).then((tab) =>
          notify(Object.freeze({ type: "tab-opened", payload: tab })),
        )
      } catch {
        notify(
          Object.freeze({
            type: "navigation-error",
            payload: Object.freeze({ identity: identity(id, tabGeneration), code: "blocked", url }),
          }),
        )
      }
      return { action: "deny" }
    })
    listen("will-navigate", (event, url) => {
      if (URL.canParse(url) && new URL(url).protocol === "https:") return
      event.preventDefault()
      const key = `${senderID}:${id}`
      blockedNavigationVersions.set(key, (blockedNavigationVersions.get(key) ?? 0) + 1)
      if (!isCurrent(senderID, id, tabGeneration)) return
      notify(
        Object.freeze({
          type: "navigation-error",
          payload: Object.freeze({ identity: identity(id, tabGeneration), code: "blocked", url }),
        }),
      )
    })
    listen("will-redirect", (event, url) => {
      if (URL.canParse(url) && new URL(url).protocol === "https:") return
      event.preventDefault()
      const key = `${senderID}:${id}`
      blockedNavigationVersions.set(key, (blockedNavigationVersions.get(key) ?? 0) + 1)
      if (!isCurrent(senderID, id, tabGeneration)) return
      notify(
        Object.freeze({
          type: "navigation-error",
          payload: Object.freeze({ identity: identity(id, tabGeneration), code: "blocked", url }),
        }),
      )
    })
    listen("enter-html-full-screen", () => {
      if (!isCurrent(senderID, id, tabGeneration)) return
      const epoch = (fullscreenEpoch.get(senderID) ?? 0) + 1
      fullscreenEpoch.set(senderID, epoch)
      void (async () => {
        const deadline = Date.now() + 3_000
        let fullscreen = false
        while (Date.now() < deadline) {
          fullscreen = await view.webContents.executeJavaScript("Boolean(document.fullscreenElement)", true).catch(() => false)
          if (fullscreen) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (!fullscreen || fullscreenEpoch.get(senderID) !== epoch || !isCurrent(senderID, id, tabGeneration) || active.get(senderID) !== id || win.isDestroyed() || (fullscreenOwner.has(senderID) && fullscreenOwner.get(senderID) !== id)) {
          if (fullscreenEpoch.get(senderID) !== epoch) return
          void view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
          if (!win.isDestroyed() && win.isFullScreen() && (!fullscreenOwner.has(senderID) || fullscreenOwner.get(senderID) === id)) win.setFullScreen(false)
          return
        }
        fullscreenOwner.set(senderID, id)
        if (!win.isFullScreen()) win.setFullScreen(true)
        notify(
          Object.freeze({
            type: "fullscreen",
            payload: Object.freeze({ identity: identity(id, tabGeneration), enabled: true }),
          }),
        )
      })()
    })
    listen("leave-html-full-screen", () => {
      if (!isCurrent(senderID, id, tabGeneration)) return
      const epoch = (fullscreenEpoch.get(senderID) ?? 0) + 1
      fullscreenEpoch.set(senderID, epoch)
      void (async () => {
        if (fullscreenEpoch.get(senderID) !== epoch) return
        await view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
        const deadline = Date.now() + 3_000
        let fullscreen = true
        while (Date.now() < deadline) {
          fullscreen = await view.webContents.executeJavaScript("Boolean(document.fullscreenElement)", true).catch(() => true)
          if (!fullscreen) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (fullscreen || fullscreenEpoch.get(senderID) !== epoch || !isCurrent(senderID, id, tabGeneration) || fullscreenOwner.get(senderID) !== id) return
        fullscreenOwner.delete(senderID)
        fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
        if (!win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false)
        notify(
          Object.freeze({
            type: "fullscreen",
            payload: Object.freeze({ identity: identity(id, tabGeneration), enabled: false }),
          }),
        )
      })()
    })
    view.setBounds(bounds)
    const senderTabs = tabs.get(senderID) ?? new Map<string, AppDockRecord>()
    senderTabs.set(id, { view, win, storageKey, generation: tabGeneration, state: snapshot, notify, cleanups })
    tabByContents.set(view.webContents.id, { senderID, tabID: id, generation: tabGeneration })
    tabs.set(senderID, senderTabs)
    installFullscreenWindowBridge(senderID, win)
    if (replacement?.selected ?? true) {
      const fullscreenTabID = fullscreenOwner.get(senderID)
      if (fullscreenTabID && fullscreenTabID !== id) {
        const fullscreenRecord = senderTabs.get(fullscreenTabID)
        fullscreenOwner.delete(senderID)
        fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
        if (fullscreenRecord) void fullscreenRecord.view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
        if (!win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false)
      }
      win.contentView.addChildView(view)
      view.setVisible(true)
      view.webContents.setBackgroundThrottling(false)
      active.set(senderID, id)
    }
    for (const [tabID, other] of senderTabs) {
      if ((replacement?.selected ?? true) && tabID !== id) {
        win.contentView.removeChildView(other.view)
        markInactive(senderID, tabID, other)
      }
    }
    if (!(replacement?.selected ?? true)) markInactive(senderID, id, senderTabs.get(id)!)
    void view.webContents.loadURL(target).catch(() => {
      if (!isCurrent(senderID, id, tabGeneration)) return
      notify(
        Object.freeze({
          type: "navigation-error",
          payload: Object.freeze({ identity: identity(id, tabGeneration), code: "failed", url: target }),
        }),
      )
    })
    update({})
    return Object.freeze({ ...identity(id, tabGeneration), url: target })
  }
  return {
    open,
    resize(senderID: number, bounds: DockBounds) {
      if (!validBounds(bounds)) throw new Error("Invalid App Dock bounds")
      if (!usableBounds(bounds)) return
      layoutBounds.set(senderID, bounds)
      lastLayoutBounds = bounds
      const tabID = active.get(senderID)
      if (tabID) tabs.get(senderID)?.get(tabID)?.view.setBounds(bounds)
    },
    hide(senderID: number, _win: BrowserWindow) {
      const fullscreenTabID = fullscreenOwner.get(senderID)
      const fullscreenRecord = fullscreenTabID ? tabs.get(senderID)?.get(fullscreenTabID) : undefined
      if (fullscreenRecord) {
        void fullscreenRecord.view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
        fullscreenRecord.notify(Object.freeze({ type: "fullscreen", payload: Object.freeze({ identity: identity(fullscreenTabID!, fullscreenRecord.generation), enabled: false }) }))
      }
      fullscreenOwner.delete(senderID)
      fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
      if (fullscreenRecord && !fullscreenRecord.win.isDestroyed() && fullscreenRecord.win.isFullScreen()) fullscreenRecord.win.setFullScreen(false)
      while (active.has(senderID) && inactive.size >= MAX_INACTIVE_TABS) {
        if (!evictOldestInactive()) throw new Error("App Dock tab limit reached")
      }
      for (const [tabID, record] of tabs.get(senderID) ?? []) {
        if (!record.win.isDestroyed()) record.win.contentView.removeChildView(record.view)
        markInactive(senderID, tabID, record)
      }
      active.delete(senderID)
    },
    select(senderID: number, win: BrowserWindow, tabID: string, bounds: DockBounds) {
      if (!validBounds(bounds)) throw new Error("Invalid App Dock bounds")
      layoutBounds.set(senderID, bounds)
      lastLayoutBounds = bounds
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      const fullscreenTabID = fullscreenOwner.get(senderID)
      if (fullscreenTabID && fullscreenTabID !== tabID) {
        const fullscreenRecord = tabs.get(senderID)?.get(fullscreenTabID)
        fullscreenOwner.delete(senderID)
        fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
        if (fullscreenRecord) void fullscreenRecord.view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
        if (!win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false)
      }
      for (const [id, other] of tabs.get(senderID) ?? []) {
        if (id === tabID) {
          win.contentView.addChildView(other.view)
          other.view.webContents.setBackgroundThrottling(false)
          inactive.delete(`${senderID}:${id}`)
        } else {
          win.contentView.removeChildView(other.view)
          markInactive(senderID, id, other)
        }
      }
      record.view.setBounds(bounds)
      active.set(senderID, tabID)
      record.notify(Object.freeze({ type: "tab-selected", payload: identity(tabID, record.generation) }))
    },
    activate(senderID: number, win: BrowserWindow, tabID: string) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      const remembered = layoutBounds.get(senderID) ?? lastLayoutBounds
      const rendered = [...(tabs.get(senderID)?.values() ?? [])]
        .map((item) => item.view.getBounds())
        .find((item) => usableBounds(item))
      const windowBounds = win.getContentBounds()
      const fallback = {
        x: 0,
        y: 0,
        width: Math.max(1, Math.floor(windowBounds.width)),
        height: Math.max(1, Math.floor(windowBounds.height)),
      }
      const bounds = (remembered && usableBounds(remembered) ? remembered : undefined) ?? rendered ??
        (usableBounds(fallback) ? fallback : undefined)
      if (!bounds) throw new Error("App Dock host is not ready")
      this.select(senderID, win, tabID, bounds)
    },
    async navigate(senderID: number, tabID: string, address: string): Promise<{ ok: boolean; url: string }> {
      const key = `${senderID}:${tabID}`
      const requested = tabs.get(senderID)?.get(tabID)
      if (!requested) throw new Error("Unknown App Dock tab")
      const requestedGeneration = requested.generation
      const previous = navigationQueues.get(key)
      const navigation = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
        const record = tabs.get(senderID)?.get(tabID)
        if (!record || record.generation !== requestedGeneration) throw new Error("App Dock tab changed during navigation")
        refTargets.delete(key)
        let target: string
        try {
          target = appDockURL(address)
        } catch {
          if (isCurrent(senderID, tabID, record.generation)) {
            record.notify(
              Object.freeze({
                type: "navigation-error",
                payload: Object.freeze({ identity: identity(tabID, record.generation), code: "blocked", url: address }),
              }),
            )
          }
          throw new Error("App Dock only supports HTTPS URLs")
        }
        let navigationTimer: NodeJS.Timeout | undefined
        try {
          await Promise.race([
            record.view.webContents.loadURL(target),
            new Promise<never>((_, reject) => {
              navigationTimer = setTimeout(() => {
                if (!record.view.webContents.isDestroyed() && isCurrent(senderID, tabID, record.generation)) record.view.webContents.stop()
                reject(new Error("navigation timeout"))
              }, 10_000)
            }),
          ])
        } catch (error) {
          if (isCurrent(senderID, tabID, record.generation)) {
            record.notify(
              Object.freeze({
                type: "navigation-error",
                payload: Object.freeze({ identity: identity(tabID, record.generation), code: "failed", url: target }),
              }),
            )
          }
          throw new Error("Navigation failed: " + (error instanceof Error ? error.message : String(error)))
        } finally {
          if (navigationTimer) clearTimeout(navigationTimer)
        }
        if (!isCurrent(senderID, tabID, record.generation)) throw new Error("App Dock tab changed during navigation")
        refNamespaces.set(key, ++refNamespace)
        return { ok: true, url: record.view.webContents.getURL() || target }
      })
      navigationQueues.set(key, navigation)
      try {
        return await navigation
      } finally {
        if (navigationQueues.get(key) === navigation) navigationQueues.delete(key)
      }
    },
    async recover(senderID: number, tabID: string) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      const url = record.view.webContents.getURL()
      let target: string
      try {
        target = appDockURL(url)
      } catch {
        throw new Error("App Dock only supports HTTPS URLs")
      }
      const bounds = record.view.getBounds()
      const selected = active.get(senderID) === tabID
      remove(senderID, tabID)
      const tab = await open(
        senderID,
        record.win,
        target,
        bounds,
        record.notify,
        { storageKey: record.storageKey },
        {
          tabID,
          selected,
        },
      )
      if (isCurrent(senderID, tabID, tab.generation))
        record.notify(Object.freeze({ type: "tab-recovered", payload: tab }))
      return tab
    },
    async command(senderID: number, tabID: string, command: "back" | "forward" | "reload"): Promise<{ ok: boolean; navigated: boolean }> {
      const key = `${senderID}:${tabID}`
      const requested = tabs.get(senderID)?.get(tabID)
      if (!requested) throw new Error("Unknown App Dock tab")
      const requestedGeneration = requested.generation
      const previous = navigationQueues.get(key)
      const queued = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
        const record = tabs.get(senderID)?.get(tabID)
        if (!record || record.generation !== requestedGeneration) throw new Error("App Dock tab changed during navigation")
        refTargets.delete(key)
        let navigated = false
        if (command === "back" && record.view.webContents.canGoBack()) {
          await record.view.webContents.goBack()
          navigated = true
        } else if (command === "forward" && record.view.webContents.canGoForward()) {
          await record.view.webContents.goForward()
          navigated = true
        } else if (command === "reload") {
          await record.view.webContents.reload()
          navigated = true
        }
        if (!isCurrent(senderID, tabID, requestedGeneration)) throw new Error("App Dock tab changed during navigation")
        if (navigated) refNamespaces.set(key, ++refNamespace)
        return { ok: true, navigated }
      })
      navigationQueues.set(key, queued)
      try {
        return await queued
      } finally {
        if (navigationQueues.get(key) === queued) navigationQueues.delete(key)
      }
    },
    find(senderID: number, tabID: string, text: string, forward: boolean, notify: (result: AppDockFindResult) => void) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      const query = text.trim()
      if (!query) throw new Error("Find text is required")
      let requestID = -1
      const listener = (_event: Electron.Event, result: Electron.FoundInPageResult) => {
        if (result.requestId !== requestID || !isCurrent(senderID, tabID, record.generation)) return
        notify(
          Object.freeze({
            ...identity(tabID, record.generation),
            requestID,
            activeMatchOrdinal: result.activeMatchOrdinal,
            matches: result.matches,
            finalUpdate: result.finalUpdate,
          }),
        )
        if (result.finalUpdate) record.view.webContents.removeListener("found-in-page", listener)
      }
      record.view.webContents.on("found-in-page", listener)
      record.cleanups.push(() => record.view.webContents.removeListener("found-in-page", listener))
      requestID = record.view.webContents.findInPage(query, { forward, findNext: true })
      return requestID
    },
    stopFind(senderID: number, tabID: string) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      record.view.webContents.stopFindInPage("clearSelection")
    },
    zoom(senderID: number, tabID: string, factor?: number) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      if (factor !== undefined) record.view.webContents.setZoomFactor(appDockZoom(factor))
      return record.view.webContents.getZoomFactor()
    },
    async fullscreen(senderID: number, win: BrowserWindow, tabID: string, enabled: boolean) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      const epoch = (fullscreenEpoch.get(senderID) ?? 0) + 1
      fullscreenEpoch.set(senderID, epoch)
      if (!enabled) {
        if (fullscreenOwner.get(senderID) === tabID) {
          fullscreenOwner.delete(senderID)
          fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
          if (!win.isDestroyed()) win.setFullScreen(false)
          record.notify(Object.freeze({ type: "fullscreen", payload: Object.freeze({ identity: identity(tabID, record.generation), enabled: false }) }))
        }
        await record.view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
      }
      if (enabled) {
        const owner = fullscreenOwner.get(senderID)
        if (active.get(senderID) !== tabID || (owner && owner !== tabID)) return
        fullscreenOwner.set(senderID, tabID)
        win.setFullScreen(true)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (!isCurrent(senderID, tabID, record.generation) || fullscreenEpoch.get(senderID) !== epoch) return
      record.notify(
        Object.freeze({
          type: "fullscreen",
          payload: Object.freeze({ identity: identity(tabID, record.generation), enabled: win.isFullScreen() }),
        }),
      )
    },
    cancelDownload(senderID: number, id: string) {
      const download = downloads.get(id)
      if (!download || download.senderID !== senderID) throw new Error("Unknown App Dock download")
      download.item.cancel()
    },
    openDownload(senderID: number, id: string) {
      const download = downloads.get(id)
      if (!download || download.senderID !== senderID || download.state.state !== "completed")
        throw new Error("Unknown App Dock download")
      return shell.openPath(download.item.getSavePath())
    },
    openDevTools(senderID: number, tabID: string) {
      if (!developmentMode()) throw new Error("App Dock DevTools are disabled in production")
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      record.view.webContents.openDevTools({ mode: "detach" })
    },
    async deleteStorage(storageKey: string, _win?: BrowserWindow) {
      const partition = storagePartition(storageKey)
      if (retiredStorageKeys.has(storageKey)) throw new Error("App Dock storage key is retired")
      retiredStorageKeys.add(storageKey)
      for (const [senderID, senderTabs] of tabs) {
        for (const [tabID, record] of senderTabs) if (record.storageKey === storageKey) remove(senderID, tabID)
      }
      for (const [downloadID, download] of downloads) {
        if (download.storageKey === storageKey) {
          download.item.cancel()
          downloads.delete(downloadID)
          terminalDownloads.delete(downloadID)
        }
      }
      const browserSession = browserSessions.get(partition) ?? session.fromPartition(partition)
      await browserSession.clearStorageData()
      await browserSession.clearCache()
      browserSessions.delete(partition)
    },
    list(senderID: number) {
      return [...(tabs.get(senderID) ?? [])].map(([tabID, record]) =>
        Object.freeze({
          ...record.state(),
          viewBounds: record.view.getBounds(),
          layoutBounds: layoutBounds.get(senderID) ?? lastLayoutBounds ?? null,
          windowBounds: record.win.getContentBounds(),
          url: record.view.webContents.getURL() || record.state().url,
          title: record.view.webContents.getTitle() || record.state().title,
          active: active.get(senderID) === tabID,
        }),
      )
    },
    async execute(senderID: number, tabID: string, script: string) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      const generation = record.generation
      let executionTimer: NodeJS.Timeout | undefined
      const execution = record.view.webContents.executeJavaScript(script).catch((error: unknown) => {
        throw new Error(`App Dock page execution failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      const value = await Promise.race([
        execution,
        new Promise<never>((_, reject) => {
          executionTimer = setTimeout(() => reject(new Error("App Dock page execution timed out")), APP_DOCK_EXECUTION_TIMEOUT_MS)
        }),
      ]).finally(() => {
        if (executionTimer) clearTimeout(executionTimer)
      })
      if (!isCurrent(senderID, tabID, generation)) throw new Error("App Dock tab changed during execution")
      return value
    },
    read(senderID: number, tabID: string, budget: number, maxText: number) {
      const key = `${senderID}:${tabID}`
      const namespace = refNamespaces.get(key) ?? 1
      const flightKey = `${key}:${namespace}:${budget}:${maxText}`
      const pending = readQueues.get(flightKey)
      if (pending) return pending
      const current = this.execute(senderID, tabID, buildSnapshotScript({ budget, maxText, namespace }))
        .then((snapshot) => {
          if (refNamespaces.get(key) !== namespace) throw new Error("App Dock page changed during read; retry")
          if (snapshot && typeof snapshot === "object" && "items" in snapshot && Array.isArray(snapshot.items) && "url" in snapshot) {
            const targets = new Map<number, { x: number; y: number; width: number; height: number; tag: string; name: string; href?: string; url: string }>()
            for (const item of snapshot.items) {
              if (!item || typeof item !== "object") continue
              const candidate = item as Record<string, unknown>
              if (
                typeof candidate.ref === "number" &&
                typeof candidate.x === "number" &&
                typeof candidate.y === "number" &&
                typeof candidate.width === "number" &&
                typeof candidate.height === "number" &&
                typeof candidate.tag === "string"
              ) {
                targets.set(candidate.ref, {
                  x: candidate.x,
                  y: candidate.y,
                  width: candidate.width,
                  height: candidate.height,
                  tag: candidate.tag,
                  name: typeof candidate.name === "string" ? candidate.name : "",
                  href: typeof candidate.href === "string" ? candidate.href : undefined,
                  url: String(snapshot.url),
                })
              }
            }
            refTargets.set(key, targets)
          }
          return snapshot
        })
      readQueues.set(flightKey, current)
      void current.then(
        () => {
          if (readQueues.get(flightKey) === current) readQueues.delete(flightKey)
        },
        () => {
          if (readQueues.get(flightKey) === current) readQueues.delete(flightKey)
        },
      )
      return current
    },
    async click(senderID: number, tabID: string, ref: number) {
      const record = tabs.get(senderID)?.get(tabID)
      const view = record?.view
      const win = record?.win
      if (!view || !win) throw new Error("Unknown App Dock tab")
      const beforeURL = view.webContents.getURL()
      const key = `${senderID}:${tabID}`
      const refNamespaceAtStart = refNamespaces.get(key) ?? 0
      const blockedNavigationVersion = blockedNavigationVersions.get(key) ?? 0
      const point = await this.execute(senderID, tabID, buildElementPointScript(ref, refNamespaceAtStart))
      if (!point || typeof point !== "object" || !("ok" in point) || point.ok !== true) return point
      if (refNamespaces.get(key) !== refNamespaceAtStart)
        return { ok: false, ref, trusted: false, error: "Element ref became stale; re-read the page" }
      const target = point as { ok: true; x: number; y: number; tag: string; name?: string; href?: string }
      const isLinkControl = target.tag === "a" || Boolean(target.href)
      const pageFullscreen = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => false)
      const requiresUserGesture = pageFullscreen || /full\s*screen|fullscreen|tela inteira/i.test(target.name ?? "")
      let navigationBlocked = false
      const waitForNavigation = () => new Promise<void>((resolve) => {
            let timer: NodeJS.Timeout | undefined
            const finish = () => {
              view.webContents.removeListener("did-navigate", finish)
              view.webContents.removeListener("did-navigate-in-page", finish)
              view.webContents.removeListener("will-redirect", blockedRedirect)
              view.webContents.removeListener("will-navigate", blockedNavigate)
              if (timer) clearTimeout(timer)
              resolve()
            }
            const blockedRedirect = (_event: unknown, url: string) => {
              if (URL.canParse(url) && new URL(url).protocol === "https:") return
              navigationBlocked = true
              finish()
            }
            const blockedNavigate = (_event: unknown, url: string) => {
              if (URL.canParse(url) && new URL(url).protocol === "https:") return
              navigationBlocked = true
              finish()
            }
            view.webContents.once("did-navigate", finish)
            view.webContents.once("did-navigate-in-page", finish)
            view.webContents.on("will-redirect", blockedRedirect)
            view.webContents.on("will-navigate", blockedNavigate)
               timer = setTimeout(finish, isLinkControl ? 2_000 : 250)
            })
      const navigationDone = waitForNavigation()
      if (!win.isFocused()) win.focus()
      view.webContents.focus()
      const requiresNativeInput = isLinkControl || requiresUserGesture
      if (!requiresNativeInput) {
        const activated = await this.execute(senderID, tabID, buildClickScript(ref, refNamespaceAtStart))
        if (!activated || typeof activated !== "object" || !("ok" in activated) || activated.ok !== true) return activated
        await navigationDone
        const url = view.webContents.getURL() || beforeURL
        navigationBlocked ||= (blockedNavigationVersions.get(`${senderID}:${tabID}`) ?? 0) > blockedNavigationVersion
        if (navigationBlocked) return { ok: false, ref, trusted: false, url, navigation: "blocked", error: "Navigation blocked" }
        return {
          ...(activated && typeof activated === "object" ? activated : {}),
          ok: true,
          ref,
          trusted: false,
          url,
          navigated: url !== beforeURL,
          navigation: url !== beforeURL ? "completed" : isLinkControl ? "unchanged" : "not-applicable",
        }
      }
      const fullscreenBefore = requiresUserGesture
        ? await this.execute(senderID, tabID, "({ document: Boolean(document.fullscreenElement), window: window.outerWidth === screen.width && window.outerHeight === screen.height })")
            .catch(() => undefined)
        : undefined
      if (requiresUserGesture && !fullscreenBefore) {
        return { ok: false, ref, trusted: true, error: "Fullscreen state could not be observed before click" }
      }
      const viewport = await this.execute(senderID, tabID, "({ width: innerWidth, height: innerHeight })").catch(() => undefined)
      const viewBounds = view.getBounds()
      const viewportWidth = viewport && typeof viewport === "object" ? Number((viewport as { width?: unknown }).width) : 0
      const viewportHeight = viewport && typeof viewport === "object" ? Number((viewport as { height?: unknown }).height) : 0
      const scaleX = viewportWidth > 1 ? viewBounds.width / viewportWidth : 1
      const scaleY = viewportHeight > 1 ? viewBounds.height / viewportHeight : 1
      const inputX = target.x * scaleX
      const inputY = target.y * scaleY
      if (refNamespaces.get(key) !== refNamespaceAtStart)
        return { ok: false, ref, trusted: false, error: "Element target became stale; re-read the page" }
      view.webContents.sendInputEvent({ type: "mouseMove", x: inputX, y: inputY })
      view.webContents.sendInputEvent({ type: "mouseDown", x: inputX, y: inputY, button: "left", clickCount: 1 })
      view.webContents.sendInputEvent({ type: "mouseUp", x: inputX, y: inputY, button: "left", clickCount: 1 })
      if (fullscreenBefore && typeof fullscreenBefore === "object") {
        let escapeSent = false
        let domFallback: unknown
        let entryFallback: unknown
        let rawClickSent = false
        if ((fullscreenBefore as Record<string, unknown>).document === false) {
          let entered = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => false)
          if (!entered) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            entered = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => false)
          }
          if (!entered) {
            rawClickSent = true
            view.webContents.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y })
            view.webContents.sendInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 })
            view.webContents.sendInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 })
            await new Promise((resolve) => setTimeout(resolve, 250))
            entered = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => false)
          }
          if (!entered) {
            entryFallback = await view.webContents.executeJavaScript(buildClickScript(ref, refNamespaceAtStart), true).catch((error: unknown) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }))
            await new Promise((resolve) => setTimeout(resolve, 100))
            entered = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => false)
          }
        }
        if ((fullscreenBefore as Record<string, unknown>).document === true) {
          let stillDocumentFullscreen = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => true)
          if (stillDocumentFullscreen) {
            escapeSent = true
            view.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESC" })
            view.webContents.sendInputEvent({ type: "keyUp", keyCode: "ESC" })
            await new Promise((resolve) => setTimeout(resolve, 100))
            stillDocumentFullscreen = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => true)
          }
          if (stillDocumentFullscreen) {
            domFallback = await view.webContents.executeJavaScript(buildClickScript(ref, refNamespaceAtStart), true).catch((error: unknown) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }))
            await new Promise((resolve) => setTimeout(resolve, 100))
            stillDocumentFullscreen = await this.execute(senderID, tabID, "Boolean(document.fullscreenElement)").catch(() => true)
          }
          if (stillDocumentFullscreen) await view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
        }
        let fullscreenAfter: unknown = fullscreenBefore
        const deadline = Date.now() + 3_000
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          fullscreenAfter = await this.execute(
            senderID,
            tabID,
            "({ document: Boolean(document.fullscreenElement), window: window.outerWidth === screen.width && window.outerHeight === screen.height })",
          ).catch(() => fullscreenAfter)
          const beforeDoc = (fullscreenBefore as Record<string, unknown>).document
          const afterDoc = (fullscreenAfter as Record<string, unknown>)?.document
          if (afterDoc !== beforeDoc) break
        }
        const beforeDoc = (fullscreenBefore as Record<string, unknown>).document
        const afterDoc = (fullscreenAfter as Record<string, unknown>)?.document
        if (afterDoc === beforeDoc) {
          return {
            ok: false,
            ref,
            trusted: true,
            error: "Fullscreen transition was not observed",
            diagnostics: {
              before: fullscreenBefore,
              after: fullscreenAfter,
              escapeSent,
              domFallback,
              entryFallback,
              rawClickSent,
              viewBounds,
              inputPoint: { x: inputX, y: inputY },
              viewport,
              windowFullScreen: win.isFullScreen(),
              target: { x: target.x, y: target.y, tag: target.tag, name: target.name },
            },
          }
        }
        if (afterDoc === false && !win.isDestroyed()) win.setFullScreen(false)
      }
      await navigationDone
      let url = view.webContents.getURL() || beforeURL
      let trusted = true
      if (!navigationBlocked && isLinkControl && url === beforeURL) {
        const fallbackNavigation = waitForNavigation()
          const fallback = await this.execute(senderID, tabID, buildClickScript(ref, refNamespaceAtStart)).catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
        if (!fallback || typeof fallback !== "object" || !("ok" in fallback) || fallback.ok !== true)
          return { ok: false, ref, trusted: false, url, navigation: "unchanged", error: (fallback as { error?: string })?.error ?? "Click failed" }
        await fallbackNavigation
        url = view.webContents.getURL() || beforeURL
        trusted = false
      }
      if (navigationBlocked) return { ok: false, ref, trusted, url, navigation: "blocked", error: "Navigation blocked" }
      return {
        ok: true,
        ref,
        x: target.x,
        y: target.y,
        tag: target.tag,
        trusted,
        url,
        navigated: url !== beforeURL,
        navigation: url !== beforeURL ? "completed" : target.href ? "unchanged" : "not-applicable",
      }
    },
    async type(senderID: number, tabID: string, ref: number, text: string) {
      const namespace = refNamespaces.get(`${senderID}:${tabID}`) ?? 0
      const focus = await this.execute(senderID, tabID, buildFocusScript(ref, namespace))
      if (!focus || typeof focus !== "object" || !("ok" in focus) || focus.ok !== true) return focus
      const view = tabs.get(senderID)?.get(tabID)?.view
      if (!view) throw new Error("Unknown App Dock tab")
      const domResult = await this.execute(senderID, tabID, buildTypeScript(ref, text, namespace))
      if (!domResult || typeof domResult !== "object" || !("ok" in domResult) || domResult.ok !== true) return domResult
      const observed = await this.execute(senderID, tabID, buildReadElementScript(ref, namespace))
      if (!observed || typeof observed !== "object" || !("ok" in observed) || observed.ok !== true)
        return { ok: false, ref, text, error: "Input value could not be verified" }
      const value = String((observed as { value?: unknown }).value ?? "")
      if (value !== text) return { ok: false, ref, text, value, error: "Input value did not match requested text" }
      return { ok: true, ref, text, value, trusted: true }
    },
    close,
    closeAll,
    closeTabs(senderID: number, tabID: string, scope: "others" | "right", order?: string[]) {
      const senderTabs = tabs.get(senderID)
      if (!senderTabs) throw new Error("Unknown App Dock tab")
      const targetRecord = senderTabs.get(tabID)
      if (!targetRecord) throw new Error("Unknown App Dock tab")
      const ids = [...senderTabs]
        .filter(([, record]) => record.storageKey === targetRecord.storageKey)
        .map(([id]) => id)
      if (scope === "others" && order !== undefined) throw new Error("Invalid App Dock tab order")
      if (
        order !== undefined &&
        (!Array.isArray(order) ||
          order.length !== ids.length ||
          order.some((id) => typeof id !== "string" || id.length === 0) ||
          new Set(order).size !== order.length ||
          !ids.every((id) => order.includes(id)))
      ) {
        throw new Error("Invalid App Dock tab order")
      }
      const ordered = order ?? ids
      const target = ordered.indexOf(tabID)
      const closing = scope === "others" ? ids.filter((id) => id !== tabID) : ordered.slice(target + 1)
      const currentActive = active.get(senderID)
      closing.forEach((id) => remove(senderID, id))
      if (senderTabs.size === 0) tabs.delete(senderID)
      else if (!currentActive || closing.includes(currentActive)) {
        const bounds = layoutBounds.get(senderID) ?? targetRecord.view.getBounds()
        this.select(senderID, targetRecord.win, tabID, bounds)
      }
    },
    scroll(senderID: number, tabID: string, direction: "up" | "down" | "top" | "bottom", amount?: number) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      if (direction !== "up" && direction !== "down" && direction !== "top" && direction !== "bottom")
        throw new Error("Invalid App Dock direction")
      refTargets.delete(`${senderID}:${tabID}`)
      return this.execute(senderID, tabID, buildScrollScript(direction, amount)) as Promise<{ ok: boolean; direction: string; amount: number; before: { x: number; y: number }; after: { x: number; y: number } }>
    },
    hover(senderID: number, tabID: string, ref: number) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildHoverScript(ref, refNamespaces.get(`${senderID}:${tabID}`) ?? 0))
    },
    drag(senderID: number, tabID: string, fromRef: number, toRef: number) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildDragScript(fromRef, toRef, refNamespaces.get(`${senderID}:${tabID}`) ?? 0))
    },
    clickAt(senderID: number, tabID: string, x: number, y: number) {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      const bounds = record.view.getBounds()
      if (bounds.width <= 1 || bounds.height <= 1)
        return Promise.resolve({ ok: false, error: "App Dock tab viewport is not ready; retry after layout", retryable: true })
      const beforeURL = record.view.webContents.getURL()
      const key = `${senderID}:${tabID}`
      const refNamespaceAtStart = refNamespaces.get(key) ?? 0
      const blockedNavigationVersion = blockedNavigationVersions.get(key) ?? 0
      return this.execute(senderID, tabID, buildClickAtProbeScript(x, y, refNamespaceAtStart)).then(async (result) => {
        if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) return result
        const target = result as { ok: true; tag?: string; href?: string; ref?: number }
        if (refNamespaces.get(key) !== refNamespaceAtStart)
          return { ok: false, error: "Element target became stale; re-read the page" }
        let observedBlocked = false
        const waitForNavigation = () => new Promise<void>((resolve) => {
               let timer: NodeJS.Timeout | undefined
               const finish = () => {
                 record.view.webContents.removeListener("did-navigate", finish)
                 record.view.webContents.removeListener("did-navigate-in-page", finish)
                 record.view.webContents.removeListener("will-redirect", blockedRedirect)
                 record.view.webContents.removeListener("will-navigate", blockedNavigate)
                 if (timer) clearTimeout(timer)
                 resolve()
               }
               const blockedRedirect = (_event: unknown, url: string) => {
                 if (URL.canParse(url) && new URL(url).protocol === "https:") return
                 observedBlocked = true
                 finish()
               }
               const blockedNavigate = (_event: unknown, url: string) => {
                 if (URL.canParse(url) && new URL(url).protocol === "https:") return
                 observedBlocked = true
                 finish()
               }
               record.view.webContents.once("did-navigate", finish)
               record.view.webContents.once("did-navigate-in-page", finish)
               record.view.webContents.on("will-redirect", blockedRedirect)
               record.view.webContents.on("will-navigate", blockedNavigate)
               timer = setTimeout(finish, target.href ? 2_000 : 250)
             })
        const navigationDone = waitForNavigation()
        if (!record.win.isFocused()) record.win.focus()
        record.view.webContents.focus()
        const viewport = await this.execute(senderID, tabID, "({ width: innerWidth, height: innerHeight })").catch(() => undefined)
        const viewBounds = record.view.getBounds()
        const viewportWidth = viewport && typeof viewport === "object" ? Number((viewport as { width?: unknown }).width) : 0
        const viewportHeight = viewport && typeof viewport === "object" ? Number((viewport as { height?: unknown }).height) : 0
        const scaleX = viewportWidth > 1 ? viewBounds.width / viewportWidth : 1
        const scaleY = viewportHeight > 1 ? viewBounds.height / viewportHeight : 1
        const inputX = x * scaleX
        const inputY = y * scaleY
        if (refNamespaces.get(key) !== refNamespaceAtStart)
          return { ok: false, error: "Element target became stale; re-read the page" }
        record.view.webContents.sendInputEvent({ type: "mouseMove", x: inputX, y: inputY })
        record.view.webContents.sendInputEvent({ type: "mouseDown", x: inputX, y: inputY, button: "left", clickCount: 1 })
        record.view.webContents.sendInputEvent({ type: "mouseUp", x: inputX, y: inputY, button: "left", clickCount: 1 })
        await navigationDone
        await new Promise((resolve) => setTimeout(resolve, 50))
        const nativeClick = await this.execute(senderID, tabID, "(() => { const probe = window.__opencodeDockClickProbe; if (!probe) return false; const fired = probe.fired(); probe.cleanup(); delete window.__opencodeDockClickProbe; return fired })()")
        let url = record.view.webContents.getURL() || beforeURL
        let trusted = true
        let navigationBlocked = observedBlocked || (blockedNavigationVersions.get(`${senderID}:${tabID}`) ?? 0) > blockedNavigationVersion
        if (!navigationBlocked && url === beforeURL && !nativeClick && typeof target.ref === "number") {
          const fallbackNavigation = waitForNavigation()
          const fallback = await this.execute(senderID, tabID, buildClickScript(target.ref, refNamespaceAtStart)).catch((error: unknown) => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }))
          if (!fallback || typeof fallback !== "object" || !("ok" in fallback) || fallback.ok !== true)
            return { ok: false, ref: target.ref, trusted: false, url, navigation: "unchanged", error: (fallback as { error?: string })?.error ?? "Click failed" }
          await fallbackNavigation
          url = record.view.webContents.getURL() || beforeURL
          trusted = false
        }
        navigationBlocked ||= (blockedNavigationVersions.get(`${senderID}:${tabID}`) ?? 0) > blockedNavigationVersion
        if (navigationBlocked) return { ok: false, ref: target.ref, trusted, url, navigation: "blocked", error: "Navigation blocked" }
        return {
          ...result,
          trusted,
          url,
          navigated: url !== beforeURL,
          navigation: url !== beforeURL ? "completed" : target.href ? "unchanged" : "not-applicable",
        }
      })
    },

  /**
   * Retrieves stored data from a dock tab.
   * @senderID - Electron sender identifier
   * @tabID - Target tab identifier
   * @storage - "local" or "session" storage type
   * @key - Storage key to retrieve
   * @returns Promise resolving to { ok, storage, key } or error
   */
    storage(senderID: number, tabID: string, storage: "local" | "session", key: string): Promise<{ ok: boolean; storage: "local" | "session"; key: string; value: string | null }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildStorageScript(storage, key)) as Promise<{ ok: boolean; storage: "local" | "session"; key: string; value: string | null }>
    },
  /**
   * Captures a PDF of the dock tab.
   * @senderID - Electron sender identifier
   * @tabID - Target tab identifier
   * @returns Promise resolving to { ok, blob } or error
   */
    pdf(senderID: number, tabID: string): Promise<{ ok: boolean; blob: Blob }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildPDFSript()) as Promise<{ ok: boolean; blob: Blob }>
    },
  /**
   * Changes iframe focus in a dock tab.
   * @senderID - Electron sender identifier
   * @tabID - Target tab identifier
   * @direction - "next" or "prev" to navigate
   * @returns Promise resolving to { ok, iframe } or error
   */
    frame(senderID: number, tabID: string, direction: "next" | "prev"): Promise<{ ok: boolean; iframe: HTMLIFrameElement }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildFrameScript(direction)) as Promise<{ ok: boolean; iframe: HTMLIFrameElement }>
    },
  /**
   * Retries an operation on a dock tab with exponential backoff.
   * @senderID - Electron sender identifier
   * @tabID - Target tab identifier
   * @attempts - Maximum number of retry attempts
   * @delay - Delay in milliseconds between attempts
   * @returns Promise resolving to { ok, attemptsLeft } or error
   */
    retry(senderID: number, tabID: string, attempts: number, delay: number): Promise<{ ok: boolean; attemptsLeft: number }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildRetryScript(attempts, delay)) as Promise<{ ok: boolean; attemptsLeft: number }>
    },
  /**
   * Executes custom JavaScript in a dock tab.
   * @senderID - Electron sender identifier
   * @tabID - Target tab identifier
   * @script - JavaScript string to evaluate
   * @returns Promise resolving to { ok, result } or error
   */
    evaluate(senderID: number, tabID: string, script: string): Promise<{ ok: boolean; result: string }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildEvaluateScript(script)) as Promise<{ ok: boolean; result: string }>
    },
  /**
   * Intercepts network requests in a dock tab.
   * @senderID - Electron sender identifier
   * @tabID - Target tab identifier
   * @config - Configuration: blockUrls, allowedOrigins, blockMethods
   * @returns Promise resolving to { ok, blocked } or error
   */
    network(senderID: number, tabID: string, config: { blockUrls?: string[]; allowedOrigins?: string[]; blockMethods?: string[]; probeUrl?: string; probeMethod?: string }): Promise<{ ok: boolean; blocked: number; requests: number; interceptorReady: boolean }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      return this.execute(senderID, tabID, buildNetworkScript(config)) as Promise<{ ok: boolean; blocked: number; requests: number; interceptorReady: boolean }>
    },
    async wait(senderID: number, tabID: string, milliseconds: number): Promise<{ ok: boolean; waitedMs: number }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
      if (!isCurrent(senderID, tabID, record.generation)) throw new Error("App Dock tab changed during wait")
      return { ok: true, waitedMs: milliseconds }
    },
    async screenshot(senderID: number, tabID: string): Promise<{ mime: "image/png"; bytes: number; prefix: string; sha256: string; data: string }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      if (record.win.isDestroyed()) throw new Error("App Dock screenshot unavailable: host window is destroyed")
      if (!record.win.isVisible()) record.win.showInactive()
      const bounds = record.view.getBounds()
      let image
      try {
        image = await record.view.webContents.capturePage({
          x: 0,
          y: 0,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        })
      } catch (error) {
        try {
          image = await record.win.capturePage()
        } catch (fallbackError) {
          throw new Error(
            `App Dock screenshot unavailable: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}. Keep dock window visible and retry.`,
          )
        }
      }
      const png = image.toPNG()
      if (png.length === 0) throw new Error("App Dock screenshot unavailable: capture returned empty PNG")
      return {
        mime: "image/png",
        bytes: png.length,
        prefix: png.subarray(0, 8).toString("base64"),
        sha256: createHash("sha256").update(png).digest("hex"),
        data: png.toString("base64"),
      }
    },
    async keyboard(senderID: number, tabID: string, type: "keyDown" | "keyUp", key: string): Promise<{ ok: boolean; type: string; key: string; error?: string }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      if (!record.win.isFocused()) record.win.focus()
      record.view.webContents.focus()
      const keyCode = appDockKeyCode(key)
      let fullscreenEpochAtStart = fullscreenEpoch.get(senderID) ?? 0
      if (type === "keyDown" && keyCode === "ESC") {
        const owner = fullscreenOwner.get(senderID)
        if (owner && owner !== tabID) return { ok: false, type, key, error: "Fullscreen is owned by another tab" }
        fullscreenEpochAtStart = (fullscreenEpoch.get(senderID) ?? 0) + 1
        fullscreenEpoch.set(senderID, fullscreenEpochAtStart)
        await record.view.webContents
          .executeJavaScript("(async () => { if (!document.fullscreenElement) return false; await document.exitFullscreen?.(); return true })()", true)
          .catch(() => false)
      }
      record.view.webContents.sendInputEvent({ type, keyCode })
      if (type === "keyDown" && keyCode === "ESC") {
        const deadline = Date.now() + 1_000
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          const fullscreen = await record.view.webContents
            .executeJavaScript("Boolean(document.fullscreenElement)", true)
            .catch(() => false)
          if (!fullscreen) {
            if (fullscreenEpoch.get(senderID) !== fullscreenEpochAtStart) return { ok: true, type, key }
            if (record.win.isFullScreen()) record.win.setFullScreen(false)
            if (fullscreenOwner.get(senderID) === tabID) {
              fullscreenOwner.delete(senderID)
              fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
            }
            return { ok: true, type, key }
          }
        }
        await record.view.webContents.executeJavaScript("void document.exitFullscreen?.(); true", true).catch(() => undefined)
        const fullscreen = await record.view.webContents
          .executeJavaScript("Boolean(document.fullscreenElement)", true)
          .catch(() => false)
        if (!fullscreen) {
          if (fullscreenEpoch.get(senderID) !== fullscreenEpochAtStart) return { ok: true, type, key }
          if (record.win.isFullScreen()) record.win.setFullScreen(false)
          if (fullscreenOwner.get(senderID) === tabID) {
            fullscreenOwner.delete(senderID)
            fullscreenEpoch.set(senderID, (fullscreenEpoch.get(senderID) ?? 0) + 1)
          }
          return { ok: true, type, key }
        }
        return { ok: false, type, key, error: "Fullscreen exit was not observed" }
      }
      return { ok: true, type, key }
    },
    scrollTo(senderID: number, tabID: string, x: number, y: number): Promise<{ ok: boolean; x: number; y: number }> {
      const record = tabs.get(senderID)?.get(tabID)
      if (!record) throw new Error("Unknown App Dock tab")
      refTargets.delete(`${senderID}:${tabID}`)
      return this.execute(senderID, tabID, buildScrollToScript(x, y)) as Promise<{ ok: boolean; x: number; y: number }>
    },
  }
}
