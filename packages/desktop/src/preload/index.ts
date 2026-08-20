import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { IpcRendererEvent } from "electron"
import type { ElectronAPI } from "./types"
import type { UpdaterState } from "@opencode-ai/app/updater"
import {
  Ipc,
  type IpcEvent,
  type IpcEventListener,
  type IpcInvoke,
  type IpcInvokeArgs,
  type IpcInvokeResult,
  type IpcSend,
} from "../shared/ipc-contract"

function invoke<Channel extends keyof IpcInvoke>(channel: Channel, ...args: IpcInvokeArgs<Channel>) {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<Channel>>
}

function send<Channel extends keyof IpcSend>(channel: Channel, ...args: IpcSend[Channel]) {
  ipcRenderer.send(channel, ...args)
}

function listen<Channel extends keyof IpcEvent>(channel: Channel, listener: IpcEventListener<Channel>) {
  const handler = (_event: IpcRendererEvent, ...args: IpcEvent[Channel]) => listener(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
let updaterListener: (() => void) | undefined
const updaterHandler = (state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}
type WslInvoke = Exclude<
  (typeof Ipc.wsl)[keyof typeof Ipc.wsl],
  typeof Ipc.wsl.awaitInitialization | typeof Ipc.wsl.event
>
function invokeWsl<Channel extends WslInvoke>(channel: Channel, ...args: IpcInvokeArgs<Channel>) {
  return invoke(Ipc.wsl.awaitInitialization).then(() => invoke(channel, ...args))
}

const api: ElectronAPI = {
  awaitInitialization: () => invoke(Ipc.app.awaitInitialization),
  wslServers: {
    getState: () => invokeWsl(Ipc.wsl.getState),
    subscribe: (cb) => {
      const dispose = listen(Ipc.wsl.event, cb)
      const subscribed = invokeWsl(Ipc.wsl.subscribe)
      return () => {
        dispose()
        void subscribed.then(() => invokeWsl(Ipc.wsl.unsubscribe))
      }
    },
    probeRuntime: () => invokeWsl(Ipc.wsl.probeRuntime),
    refreshDistros: () => invokeWsl(Ipc.wsl.refreshDistros),
    installWsl: () => invokeWsl(Ipc.wsl.installWsl),
    installDistro: (name) => invokeWsl(Ipc.wsl.installDistro, name),
    probeAddable: (distros) => invokeWsl(Ipc.wsl.probeAddable, distros),
    installOpencode: (name) => invokeWsl(Ipc.wsl.installOpencode, name),
    openTerminal: (name) => invokeWsl(Ipc.wsl.openTerminal, name),
    addServer: (distro) => invokeWsl(Ipc.wsl.addServer, distro),
    removeServer: (id) => invokeWsl(Ipc.wsl.removeServer, id),
    startServer: (id) => invokeWsl(Ipc.wsl.startServer, id),
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        updaterListener = listen(Ipc.updater.state, updaterHandler)
        updaterSubscription = invoke(Ipc.updater.subscribe)
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        updaterListener?.()
        updaterListener = undefined
        updaterSubscription = undefined
        void invoke(Ipc.updater.unsubscribe)
      }
    },
    check: () => invoke(Ipc.updater.check),
    install: () => invoke(Ipc.updater.install),
  },
  consumeInitialDeepLinks: () => invoke(Ipc.app.consumeInitialDeepLinks),
  getDefaultServerUrl: () => invoke(Ipc.app.getDefaultServerUrl),
  setDefaultServerUrl: (url) => invoke(Ipc.app.setDefaultServerUrl, url),
  isFirstLaunchOnboardingPending: () => invoke(Ipc.app.isFirstLaunchOnboardingPending),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    invoke(Ipc.app.finishFirstLaunchOnboarding, createDefaultProject),
  checkAppExists: (appName) => invoke(Ipc.app.checkAppExists, appName),
  resolveAppPath: (appName) => invoke(Ipc.app.resolveAppPath, appName),
  storeGet: (name, key) => invoke(Ipc.storage.get, name, key),
  storeSet: (name, key, value) => invoke(Ipc.storage.set, name, key, value),
  storeDelete: (name, key) => invoke(Ipc.storage.delete, name, key),
  storeClear: (name) => invoke(Ipc.storage.clear, name),
  storeKeys: (name) => invoke(Ipc.storage.keys, name),
  storeLength: (name) => invoke(Ipc.storage.length, name),
  draftGet: (key) => invoke(Ipc.drafts.get, key),
  draftSet: (key, value) => invoke(Ipc.drafts.set, key, value),
  draftDelete: (key) => invoke(Ipc.drafts.delete, key),
  draftBlobPut: (data) => invoke(Ipc.drafts.putBlob, data),
  draftBlobGet: (id) => invoke(Ipc.drafts.getBlob, id),

  getWindowID: () => invoke(Ipc.window.getId),
  themeReady: () => invoke(Ipc.window.themeReady),
  onMenuCommand: (cb) => listen(Ipc.menu.command, cb),
  onDeepLink: (cb) => listen(Ipc.app.deepLink, cb),

  openDirectoryPicker: (opts) => invoke(Ipc.files.openDirectoryPicker, opts),
  openFilePicker: (opts) => invoke(Ipc.files.openFilePicker, opts),
  readPickedFile: (token, path) => invoke(Ipc.files.readPickedFile, token, path),
  releasePickedFiles: (token) => invoke(Ipc.files.releasePickedFiles, token),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveFilePicker: (opts) => invoke(Ipc.files.saveFilePicker, opts),
  openExternal: (url) => send(Ipc.files.openExternal, url),
  openLocalFile: (url) => send(Ipc.files.openLocalFile, url),
  openPath: (path, app) => invoke(Ipc.files.openPath, path, app),
  revealPath: (path) => invoke(Ipc.files.revealPath, path),
  readClipboardImage: () => invoke(Ipc.files.readClipboardImage),
  getWindowFocused: () => invoke(Ipc.window.getFocused),
  getWindowFullscreen: () => invoke(Ipc.window.getFullscreen),
  onWindowFullscreenChanged: (cb) => listen(Ipc.window.fullscreenChanged, cb),
  setWindowFocus: () => invoke(Ipc.window.setFocus),
  showWindow: () => invoke(Ipc.window.show),
  relaunch: () => send(Ipc.app.relaunch),
  getZoomFactor: () => invoke(Ipc.window.getZoomFactor),
  setZoomFactor: (factor) => invoke(Ipc.window.setZoomFactor, factor),
  getPinchZoomEnabled: () => invoke(Ipc.window.getPinchZoomEnabled),
  setPinchZoomEnabled: (enabled) => invoke(Ipc.window.setPinchZoomEnabled, enabled),
  onPinchZoomEnabledChanged: (cb) => listen(Ipc.window.pinchZoomEnabledChanged, cb),
  onZoomFactorChanged: (cb) => listen(Ipc.window.zoomFactorChanged, cb),
  setTitlebar: (theme) => invoke(Ipc.window.setTitlebar, theme),
  runDesktopMenuAction: (action) => invoke(Ipc.menu.runAction, action),
  setBackgroundColor: (color) => invoke(Ipc.app.setBackgroundColor, color),
  exportDebugLogs: () => invoke(Ipc.app.exportDebugLogs),
  setForceFocus: (enabled) => invoke(Ipc.app.setForceFocus, enabled),
  recordFatalRendererError: (error) => invoke(Ipc.app.recordFatalRendererError, error),
  setNativeTranslations: (bundle) => invoke(Ipc.app.setNativeTranslations, bundle),
}

contextBridge.exposeInMainWorld("api", api)
