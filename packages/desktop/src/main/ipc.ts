import { BrowserWindow, ipcMain } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"

import {
  Ipc,
  type FatalRendererError,
  type IpcInvoke,
  type IpcInvokeArgs,
  type IpcInvokeResult,
  type IpcSend,
  type ServerReadyData,
} from "../shared/ipc-contract"
import { createFileCapabilities, openExternalURL, openLocalFileURL } from "./files"
import { setForceFocus } from "./native/debug"
import { runDesktopMenuAction } from "./native/menu-actions"
import { createDesktopStorage } from "./storage"
import {
  getPinchZoomEnabled,
  getWindowID,
  setPinchZoomEnabled,
  setTitlebar,
  setWindowThemeReady,
  updateTitlebar,
} from "./windows"
import type { UpdaterIpc } from "./updater"
import type { WslIpc } from "./wsl/ipc"

type MaybePromise<Value> = Value | Promise<Value>

function handle<Channel extends keyof IpcInvoke>(
  channel: Channel,
  listener: (event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<Channel>) => MaybePromise<IpcInvokeResult<Channel>>,
) {
  ipcMain.handle(channel, listener)
}

function on<Channel extends keyof IpcSend>(
  channel: Channel,
  listener: (event: IpcMainEvent, ...args: IpcSend[Channel]) => void,
) {
  ipcMain.on(channel, listener)
}

type Deps = {
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  isFirstLaunchOnboardingPending: () => Promise<boolean> | boolean
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null> | string | null
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null>
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

export function registerIpcHandlers(deps: Deps) {
  const files = createFileCapabilities()
  const storage = createDesktopStorage()

  handle(Ipc.app.awaitInitialization, () => deps.awaitInitialization())
  handle(Ipc.app.consumeInitialDeepLinks, () => deps.consumeInitialDeepLinks())
  handle(Ipc.app.getDefaultServerUrl, () => deps.getDefaultServerUrl())
  handle(Ipc.app.setDefaultServerUrl, (_event, url) => deps.setDefaultServerUrl(url))
  handle(Ipc.app.isFirstLaunchOnboardingPending, () => deps.isFirstLaunchOnboardingPending())
  handle(Ipc.app.finishFirstLaunchOnboarding, (_event, createDefaultProject) =>
    deps.finishFirstLaunchOnboarding(createDefaultProject),
  )
  handle(Ipc.app.checkAppExists, (_event, appName) => deps.checkAppExists(appName))
  handle(Ipc.app.resolveAppPath, (_event, appName) => deps.resolveAppPath(appName))
  handle(Ipc.app.setBackgroundColor, (_event, color) => deps.setBackgroundColor(color))
  handle(Ipc.app.exportDebugLogs, () => deps.exportDebugLogs())
  handle(Ipc.app.setForceFocus, (event, enabled) => setForceFocus(event.sender, enabled))
  handle(Ipc.app.recordFatalRendererError, (_event, error) => deps.recordFatalRendererError(error))
  handle(Ipc.app.setNativeTranslations, (event, value) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Invalid native translation sender")
    }
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  handle(Ipc.storage.get, (_event, name, key) => {
    return storage.get(name, key)
  })
  handle(Ipc.storage.set, (_event, name, key, value) => storage.set(name, key, value))
  handle(Ipc.storage.delete, (_event, name, key) => storage.deleteValue(name, key))
  handle(Ipc.storage.clear, (_event, name) => storage.clear(name))
  handle(Ipc.storage.keys, (_event, name) => storage.keys(name))
  handle(Ipc.storage.length, (_event, name) => storage.length(name))
  handle(Ipc.drafts.get, (_event, key) => storage.drafts.get(key))
  handle(Ipc.drafts.set, (_event, key, value) => storage.drafts.set(key, value))
  handle(Ipc.drafts.delete, (_event, key) => storage.drafts.set(key, null))
  handle(Ipc.drafts.putBlob, (_event, data) => storage.drafts.putBlob(data))
  handle(Ipc.drafts.getBlob, (_event, id) => storage.drafts.getBlob(id))

  handle(Ipc.files.openDirectoryPicker, (_event, options) => files.openDirectoryPicker(options))
  handle(Ipc.files.openFilePicker, (event, options) => files.openFilePicker(event.sender.id, options))
  handle(Ipc.files.readPickedFile, (event, token, path) => files.readPickedFile(event.sender.id, token, path))
  handle(Ipc.files.releasePickedFiles, (event, token) => files.releasePickedFiles(event.sender.id, token))
  handle(Ipc.files.saveFilePicker, (_event, options) => files.saveFilePicker(options))
  on(Ipc.files.openExternal, (_event, url) => openExternalURL(url))
  on(Ipc.files.openLocalFile, (_event, url) => openLocalFileURL(url))
  handle(Ipc.files.openPath, (_event, path, app) => files.openPath(path, app))
  handle(Ipc.files.revealPath, (_event, path) => files.revealPath(path))
  handle(Ipc.files.readClipboardImage, () => files.readClipboardImage())

  handle(Ipc.window.getId, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error("Window not found")
    const id = getWindowID(win)
    if (!id) throw new Error("Window ID not found")
    return id
  })

  handle(Ipc.window.themeReady, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error("Window not found")
    setWindowThemeReady(win)
  })

  handle(Ipc.window.getFocused, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  handle(Ipc.window.getFullscreen, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  handle(Ipc.window.setFocus, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  handle(Ipc.window.show, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  on(Ipc.app.relaunch, () => {
    deps.relaunch()
  })

  handle(Ipc.window.getZoomFactor, (event) => event.sender.getZoomFactor())
  handle(Ipc.window.setZoomFactor, (event, factor) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  handle(Ipc.window.getPinchZoomEnabled, () => getPinchZoomEnabled())
  handle(Ipc.window.setPinchZoomEnabled, (_event, enabled) => {
    setPinchZoomEnabled(enabled)
  })
  handle(Ipc.window.setTitlebar, (event, theme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  handle(Ipc.menu.runAction, (event, action) => {
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })
}

export function registerUpdaterIpcHandlers(updater: UpdaterIpc) {
  handle(Ipc.updater.subscribe, (event) => updater.subscribe(event.sender))
  handle(Ipc.updater.unsubscribe, (event) => updater.unsubscribe(event.sender.id))
  handle(Ipc.updater.check, () => updater.check())
  handle(Ipc.updater.install, () => updater.install())
}

export function registerWslInitialization(ready: Promise<void>) {
  handle(Ipc.wsl.awaitInitialization, () => ready)
}

export function registerWslIpcHandlers(wsl: WslIpc) {
  handle(Ipc.wsl.subscribe, (event) => wsl.subscribe(event.sender))
  handle(Ipc.wsl.unsubscribe, (event) => wsl.unsubscribe(event.sender.id))
  handle(Ipc.wsl.getState, () => wsl.getState())
  handle(Ipc.wsl.probeRuntime, () => wsl.probeRuntime())
  handle(Ipc.wsl.refreshDistros, () => wsl.refreshDistros())
  handle(Ipc.wsl.installWsl, () => wsl.installWsl())
  handle(Ipc.wsl.installDistro, (_event, value) => wsl.installDistro(value))
  handle(Ipc.wsl.probeAddable, (_event, value) => wsl.probeAddable(value))
  handle(Ipc.wsl.installOpencode, (_event, value) => wsl.installOpencode(value))
  handle(Ipc.wsl.openTerminal, (_event, value) => wsl.openTerminal(value))
  handle(Ipc.wsl.addServer, (_event, value) => wsl.addServer(value))
  handle(Ipc.wsl.removeServer, (_event, value) => wsl.removeServer(value))
  handle(Ipc.wsl.startServer, (_event, value) => wsl.startServer(value))
}
