import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"

import type {
  AppDockEvent as CloneableAppDockEvent,
  FatalRendererError,
  ServerReadyData,
  TitlebarTheme,
} from "../preload/types"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { setForceFocus } from "./debug"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { getStore, removeStoreFileIfEmpty } from "./store"
import {
  getPinchZoomEnabled,
  getWindowID,
  openExternalURL,
  openLocalFileURL,
  setPinchZoomEnabled,
  setTitlebar,
  updateTitlebar,
} from "./windows"
import type { UpdaterController } from "./updater-controller"
import { createUpdaterSubscriptions } from "./updater-subscriptions"
import { createDesktopDraftStore } from "./draft-store"
import { nativeT } from "./native-translations"
import {
  createAppDock,
  panelBoundsToContent,
  type AppDockEvent as NativeAppDockEvent,
  type AppDockFindResult,
  type AppDockTab,
  type DockBounds,
} from "./app-dock"
import { AppDockProfileRegistry } from "./app-dock-profile-registry"
import { registerAppDockBridge, registerAppDockProfileResolver } from "./app-dock-rpc"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions: ext }]
}

const pickedFiles = createPickedFileAuthorizations()

const appDockProfileID = (value: unknown) => {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value))
    throw new Error("Invalid App Dock profile ID")
  return value
}

const appDockID = (value: unknown, name: "tab" | "download") => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid App Dock ${name} ID`)
  return value
}

const appDockBounds = (value: unknown): DockBounds => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid App Dock bounds")
  const bounds = value as Record<string, unknown>
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(
      (item) => typeof item === "number" && Number.isFinite(item),
    )
  ) {
    throw new Error("Invalid App Dock bounds")
  }
  return bounds as DockBounds
}

const appDockEventRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid App Dock event")
  return value as Record<string, unknown>
}

const appDockEventString = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Invalid App Dock event")
  return value
}

const appDockEventNumber = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid App Dock event")
  return value
}

const appDockEventBoolean = (value: unknown) => {
  if (typeof value !== "boolean") throw new Error("Invalid App Dock event")
  return value
}

const appDockEventOptionalString = (value: unknown) => {
  if (value === undefined) return undefined
  return appDockEventString(value)
}

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const appDockEventIdentity = (value: unknown) => {
  const identity = appDockEventRecord(value)
  if (
    typeof identity.tabID !== "string" ||
    identity.tabID.length === 0 ||
    !Number.isSafeInteger(identity.generation) ||
    appDockEventNumber(identity.generation) < 1
  ) {
    throw new Error("Invalid App Dock event")
  }
  return { tabID: identity.tabID, generation: appDockEventNumber(identity.generation) }
}

const toCloneableAppDockEvent = (event: unknown): CloneableAppDockEvent => {
  const source = appDockEventRecord(event)
  const payload = appDockEventRecord(source.payload)
  if (!hasExactKeys(source, ["type", "payload"])) throw new Error("Invalid App Dock event")
  if (source.type === "state") {
    if (!(
      hasExactKeys(payload, ["tabID", "generation", "url", "title", "loading", "audible"]) ||
      hasExactKeys(payload, ["tabID", "generation", "url", "title", "favicon", "loading", "audible"])
    )) {
      throw new Error("Invalid App Dock event")
    }
    const identity = appDockEventIdentity(payload)
    return {
      type: "state",
      payload: {
        ...identity,
        url: appDockEventString(payload.url),
        title: appDockEventString(payload.title),
        favicon: appDockEventOptionalString(payload.favicon),
        loading: appDockEventBoolean(payload.loading),
        audible: appDockEventBoolean(payload.audible),
      },
    }
  }
  if (source.type === "tab-opened") {
    if (
      !hasExactKeys(payload, ["tabID", "generation", "url"]) ||
      typeof payload.tabID !== "string" ||
      payload.tabID.length === 0 ||
      !Number.isSafeInteger(payload.generation) ||
      appDockEventNumber(payload.generation) < 1 ||
      typeof payload.url !== "string"
    ) {
      throw new Error("Invalid App Dock event")
    }
    return {
      type: "tab-opened",
      payload: {
        tabID: payload.tabID,
        generation: appDockEventNumber(payload.generation),
        url: payload.url,
      },
    }
  }
  if (source.type === "tab-selected") {
    if (!hasExactKeys(payload, ["tabID", "generation"])) throw new Error("Invalid App Dock event")
    return { type: "tab-selected", payload: appDockEventIdentity(payload) }
  }
  if (source.type === "tab-crashed") {
    if (!hasExactKeys(payload, ["identity", "reason"])) throw new Error("Invalid App Dock event")
    const identity = appDockEventIdentity(payload.identity)
    const reason = appDockEventString(payload.reason)
    if (reason !== "crashed" && reason !== "killed" && reason !== "oom") throw new Error("Invalid App Dock event")
    return { type: "tab-crashed", payload: { identity: { ...identity }, reason } }
  }
  if (source.type === "tab-recovered") {
    if (!hasExactKeys(payload, ["tabID", "generation", "url"])) throw new Error("Invalid App Dock event")
    const identity = appDockEventIdentity(payload)
    return { type: "tab-recovered", payload: { ...identity, url: appDockEventString(payload.url) } }
  }
  if (source.type === "download") {
    if (!hasExactKeys(payload, ["id", "tabID", "generation", "filename", "receivedBytes", "totalBytes", "state"]))
      throw new Error("Invalid App Dock event")
    const state = appDockEventString(payload.state)
    if (
      state !== "progressing" &&
      state !== "paused" &&
      state !== "completed" &&
      state !== "cancelled" &&
      state !== "interrupted"
    ) {
      throw new Error("Invalid App Dock event")
    }
    const identity = appDockEventIdentity(payload)
    return {
      type: "download",
      payload: {
        id: appDockEventString(payload.id),
        ...identity,
        filename: appDockEventString(payload.filename),
        receivedBytes: appDockEventNumber(payload.receivedBytes),
        totalBytes: appDockEventNumber(payload.totalBytes),
        state,
      },
    }
  }
  if (source.type === "permission") {
    if (!hasExactKeys(payload, ["identity", "permission", "state"])) throw new Error("Invalid App Dock event")
    const identity = appDockEventIdentity(payload.identity)
    const permission = appDockEventString(payload.permission)
    if (!/^[a-z-]{1,64}$/.test(permission) || payload.state !== "denied") throw new Error("Invalid App Dock event")
    return { type: "permission", payload: { identity: { ...identity }, permission, state: "denied" } }
  }
  if (source.type === "fullscreen") {
    if (!hasExactKeys(payload, ["identity", "enabled"])) throw new Error("Invalid App Dock event")
    const identity = appDockEventIdentity(payload.identity)
    return {
      type: "fullscreen",
      payload: {
        identity: {
          ...identity,
        },
        enabled: appDockEventBoolean(payload.enabled),
      },
    }
  }
  if (source.type === "navigation-error") {
    if (!hasExactKeys(payload, ["identity", "code", "url"])) throw new Error("Invalid App Dock event")
    const identity = appDockEventIdentity(payload.identity)
    const code = appDockEventString(payload.code)
    if (code !== "blocked" && code !== "failed") throw new Error("Invalid App Dock event")
    return {
      type: "navigation-error",
      payload: {
        identity: {
          ...identity,
        },
        code,
        url: appDockEventString(payload.url),
      },
    }
  }
  throw new Error("Unknown App Dock event")
}

type Deps = {
  killSidecar: () => Promise<void> | void
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  isFirstLaunchOnboardingPending: () => Promise<boolean> | boolean
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null> | string | null
  isOldLayoutEligible: () => Promise<boolean> | boolean
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null>
  updater: UpdaterController
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

export function registerIpcHandlers(deps: Deps) {
  const appDock = createAppDock()
  registerAppDockBridge(appDock)
  const appDockProfiles = AppDockProfileRegistry.load(app.getPath("userData"))
  const appDockDestroyHooks = new Set<number>()
  appDockProfiles.ensureActive("default")
  registerAppDockProfileResolver(() => {
    const profileID = appDockProfiles.manifest().activeProfileID || "default"
    return { profileID, storageKey: appDockProfiles.ensureActive(profileID).storageKey }
  })
  const drafts = createDesktopDraftStore(join(app.getPath("userData"), "drafts.sqlite"))
  const updaterSubscriptions = createUpdaterSubscriptions()
  app.once("will-quit", updaterSubscriptions.clear)
  app.on("before-quit", () => drafts.flush())
  app.once("will-quit", () => drafts.close())
  app.on("browser-window-created", (_event, win) => win.on("session-end", () => drafts.flush()))

  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("await-initialization", () => deps.awaitInitialization())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("is-first-launch-onboarding-pending", () => deps.isFirstLaunchOnboardingPending())
  ipcMain.handle("finish-first-launch-onboarding", (_event: IpcMainInvokeEvent, createDefaultProject: boolean) =>
    deps.finishFirstLaunchOnboarding(createDefaultProject),
  )
  ipcMain.handle("is-old-layout-eligible", () => deps.isOldLayoutEligible())
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  const appDockSender = (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame)
      throw new Error("Invalid App Dock sender")
    return win
  }
  ipcMain.handle(
    "app-dock-open",
    async (event: IpcMainInvokeEvent, address: unknown, bounds: unknown, profile: unknown = "default") => {
      const win = appDockSender(event)
      if (typeof address !== "string") throw new Error("Invalid App Dock address")
      const profileID = appDockProfileID(profile)
      const profileStorage = appDockProfiles.ensureActive(profileID)
      let opened = false
      const pendingEvents: NativeAppDockEvent[] = []
      const notify = (appDockEvent: NativeAppDockEvent) => {
        if (!opened) {
          pendingEvents.push(appDockEvent)
          return
        }
        if (!event.sender.isDestroyed()) event.sender.send("app-dock-event", toCloneableAppDockEvent(appDockEvent))
      }
      let tab: AppDockTab
      try {
        tab = await appDock.open(
          event.sender.id,
          win,
          address,
          panelBoundsToContent(appDockBounds(bounds), event.sender.getZoomFactor()),
          notify,
          profileStorage,
        )
      } catch (error) {
        if (!event.sender.isDestroyed())
          pendingEvents.forEach((appDockEvent) => event.sender.send("app-dock-event", toCloneableAppDockEvent(appDockEvent)))
        throw error
      }
      opened = true
      if (!event.sender.isDestroyed()) {
        event.sender.send("app-dock-event", toCloneableAppDockEvent({ type: "tab-opened", payload: tab }))
        pendingEvents.forEach((appDockEvent) => event.sender.send("app-dock-event", toCloneableAppDockEvent(appDockEvent)))
      }
      if (!appDockDestroyHooks.has(event.sender.id)) {
        appDockDestroyHooks.add(event.sender.id)
        event.sender.once("destroyed", () => {
          appDockDestroyHooks.delete(event.sender.id)
          appDock.closeAll(event.sender.id, win)
        })
      }
      return tab
    },
  )
  ipcMain.handle("app-dock-resize", (event: IpcMainInvokeEvent, bounds: unknown) => {
    appDockSender(event)
    appDock.resize(event.sender.id, panelBoundsToContent(appDockBounds(bounds), event.sender.getZoomFactor()))
  })
  ipcMain.handle("app-dock-hide", (event: IpcMainInvokeEvent) => {
    appDock.hide(event.sender.id, appDockSender(event))
  })
  ipcMain.handle("app-dock-close", (event: IpcMainInvokeEvent) => {
    appDock.closeAll(event.sender.id, appDockSender(event))
  })
  ipcMain.handle("app-dock-list", (event: IpcMainInvokeEvent) => {
    appDockSender(event)
    return appDock.list(event.sender.id).map((tab) => ({
      tabID: tab.tabID,
      generation: tab.generation,
      url: tab.url,
      active: tab.active,
    }))
  })
  ipcMain.handle("app-dock-close-tab", (event: IpcMainInvokeEvent, tabID: unknown) => {
    appDock.close(event.sender.id, appDockSender(event), appDockID(tabID, "tab"))
  })
  ipcMain.handle("app-dock-recover-tab", (event: IpcMainInvokeEvent, tabID: unknown) => {
    appDockSender(event)
    return appDock.recover(event.sender.id, appDockID(tabID, "tab"))
  })
  ipcMain.handle(
    "app-dock-close-tabs",
    (event: IpcMainInvokeEvent, tabID: unknown, scope: unknown, order?: unknown) => {
      appDockSender(event)
      const id = appDockID(tabID, "tab")
      if (scope !== "others" && scope !== "right") throw new Error("Invalid App Dock close scope")
      if (order !== undefined && (!Array.isArray(order) || order.some((item) => typeof item !== "string")))
        throw new Error("Invalid App Dock tab order")
      appDock.closeTabs(event.sender.id, id, scope, order)
    },
  )
  ipcMain.handle("app-dock-select", (event: IpcMainInvokeEvent, tabID: unknown, bounds: unknown) => {
    const win = appDockSender(event)
    appDock.select(
      event.sender.id,
      win,
      appDockID(tabID, "tab"),
      panelBoundsToContent(appDockBounds(bounds), event.sender.getZoomFactor()),
    )
  })
  ipcMain.handle("app-dock-navigate", (event: IpcMainInvokeEvent, tabID: unknown, address: unknown) => {
    appDockSender(event)
    if (typeof address !== "string") throw new Error("Invalid App Dock address")
    return appDock.navigate(event.sender.id, appDockID(tabID, "tab"), address)
  })
  ipcMain.handle("app-dock-command", (event: IpcMainInvokeEvent, tabID: unknown, command: unknown) => {
    appDockSender(event)
    if (command !== "back" && command !== "forward" && command !== "reload") throw new Error("Invalid App Dock command")
    return appDock.command(event.sender.id, appDockID(tabID, "tab"), command)
  })
  ipcMain.handle("app-dock-find", (event: IpcMainInvokeEvent, tabID: unknown, text: unknown, forward: unknown) => {
    appDockSender(event)
    if (typeof text !== "string") throw new Error("Invalid App Dock find text")
    if (typeof forward !== "boolean") throw new Error("Invalid App Dock find direction")
    return appDock.find(event.sender.id, appDockID(tabID, "tab"), text, forward, (result: AppDockFindResult) => {
      if (!event.sender.isDestroyed()) event.sender.send("app-dock-find-result", result)
    })
  })
  ipcMain.handle("app-dock-stop-find", (event: IpcMainInvokeEvent, tabID: unknown) => {
    appDockSender(event)
    appDock.stopFind(event.sender.id, appDockID(tabID, "tab"))
  })
  ipcMain.handle("app-dock-zoom", (event: IpcMainInvokeEvent, tabID: unknown, factor?: unknown) => {
    appDockSender(event)
    if (factor !== undefined && (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0))
      throw new Error("Invalid App Dock zoom")
    return appDock.zoom(event.sender.id, appDockID(tabID, "tab"), factor)
  })
  ipcMain.handle("app-dock-cancel-download", (event: IpcMainInvokeEvent, id: unknown) => {
    appDockSender(event)
    appDock.cancelDownload(event.sender.id, appDockID(id, "download"))
  })
  ipcMain.handle("app-dock-open-download", (event: IpcMainInvokeEvent, id: unknown) => {
    appDockSender(event)
    return appDock.openDownload(event.sender.id, appDockID(id, "download")).then(() => undefined)
  })
  ipcMain.handle("app-dock-fullscreen", (event: IpcMainInvokeEvent, tabID: unknown, enabled: unknown) => {
    const win = appDockSender(event)
    if (typeof enabled !== "boolean") throw new Error("Invalid App Dock fullscreen state")
    return appDock.fullscreen(event.sender.id, win, appDockID(tabID, "tab"), enabled)
  })
  ipcMain.handle("app-dock-get-manifest", (event: IpcMainInvokeEvent) => {
    appDockSender(event)
    return appDockProfiles.manifest()
  })
  ipcMain.handle(
    "app-dock-update-manifest",
    (event: IpcMainInvokeEvent, expectedRevision: unknown, manifest: unknown) => {
      appDockSender(event)
      return appDockProfiles.replaceManifest(expectedRevision, manifest)
    },
  )
  ipcMain.handle("app-dock-delete-profile", async (event: IpcMainInvokeEvent, payload: unknown) => {
    const win = appDockSender(event)
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !("profileID" in payload)
    ) {
      throw new Error("Invalid App Dock profile deletion")
    }
    const profileID = appDockProfileID((payload as { profileID?: unknown }).profileID)
    const profileStorage = appDockProfiles.markDeleting(profileID)
    await appDock.deleteStorage(profileStorage.storageKey, win)
    appDockProfiles.markDeleted(profileID)
  })
  ipcMain.handle("updater-subscribe", (event) => {
    const id = event.sender.id
    updaterSubscriptions.set(
      id,
      deps.updater.subscribe((state) => {
        if (event.sender.isDestroyed()) return updaterSubscriptions.delete(id)
        event.sender.send("updater-state", state)
      }),
    )
    event.sender.once("destroyed", () => updaterSubscriptions.delete(id))
  })
  ipcMain.handle("updater-unsubscribe", (event) => updaterSubscriptions.delete(event.sender.id))
  ipcMain.handle("updater-check", () => deps.updater.check())
  ipcMain.handle("updater-install", () => deps.updater.install())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("export-debug-logs", () => deps.exportDebugLogs())
  ipcMain.handle("set-force-focus", (event: IpcMainInvokeEvent, enabled: boolean) =>
    setForceFocus(event.sender, enabled),
  )
  ipcMain.handle("record-fatal-renderer-error", (_event: IpcMainInvokeEvent, error: FatalRendererError) =>
    deps.recordFatalRendererError(error),
  )
  ipcMain.handle("set-native-translations", (event: IpcMainInvokeEvent, value: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Invalid native translation sender")
    }
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  ipcMain.handle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    getStore(name).set(key, value)
  })
  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    getStore(name).delete(key)
    void removeStoreFileIfEmpty(name)
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
    void removeStoreFileIfEmpty(name)
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })
  ipcMain.handle("draft-get", (_event, key: string) => drafts.get(key))
  ipcMain.handle("draft-set", (_event, key: string, value: string) => drafts.set(key, value))
  ipcMain.handle("draft-delete", (_event, key: string) => drafts.set(key, null))
  ipcMain.handle("draft-blob-put", (_event, data: ArrayBuffer) => drafts.putBlob(new Uint8Array(data)))
  ipcMain.handle("draft-blob-get", (_event, id: string) => {
    const data = drafts.getBlob(id)
    return data ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFolder"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (
      event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFile"),
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => ({
          path: filePath,
          name: basename(filePath),
          size: (await stat(filePath)).size,
        })),
      )
      assertAttachmentBudget(files)
      const token = pickedFiles.add(event.sender.id, result.filePaths)
      return { token, files }
    },
  )

  ipcMain.handle("read-picked-file", async (event: IpcMainInvokeEvent, token: string, filePath: string) => {
    return pickedFiles.read(event.sender.id, token, filePath)
  })

  ipcMain.handle("release-picked-files", (event: IpcMainInvokeEvent, token: string) => {
    pickedFiles.release(event.sender.id, token)
  })

  ipcMain.handle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? nativeT("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  ipcMain.on("open-external", (_event: IpcMainEvent, url: string) => {
    openExternalURL(url)
  })

  ipcMain.on("open-local-file", (_event: IpcMainEvent, url: string) => {
    openLocalFileURL(url)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle("reveal-path", async (_event: IpcMainInvokeEvent, path: string) => {
    const exists = await stat(path).then(
      () => true,
      () => false,
    )
    if (!exists) return false
    shell.showItemInFolder(path)
    return true
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  ipcMain.handle("get-window-id", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error("Window not found")
    const id = getWindowID(win)
    if (!id) throw new Error("Window ID not found")
    return id
  })

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle("get-window-fullscreen", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  ipcMain.handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  ipcMain.handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  ipcMain.on("relaunch", () => {
    deps.relaunch()
  })

  ipcMain.handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  ipcMain.handle("get-pinch-zoom-enabled", () => getPinchZoomEnabled())
  ipcMain.handle("set-pinch-zoom-enabled", (_event: IpcMainInvokeEvent, enabled: boolean) => {
    setPinchZoomEnabled(enabled)
  })
  ipcMain.handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  ipcMain.handle("run-desktop-menu-action", (event: IpcMainInvokeEvent, action: DesktopMenuAction) => {
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
