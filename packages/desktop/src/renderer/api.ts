import type { ElectronAPI } from "./api-types"
import type { UpdaterState } from "@opencode-ai/app/updater"
import { invoke, listen, send } from "./ipc-client"

type Mutable<Value> =
  Value extends ReadonlyArray<unknown>
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value extends object
      ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
      : Value

const mutable = <Value>(value: Value) => value as Mutable<Value>
const toArrayBuffer = (value: Uint8Array) =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer

const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
let updaterListener: (() => void) | undefined
const updaterHandler = (state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}

export const api: ElectronAPI = {
  awaitInitialization: () => invoke("AppAwaitInitialization"),
  wslServers: {
    getState: () => invoke("WslGetState").then(mutable),
    subscribe: (cb) => {
      const dispose = listen("WslServersChanged", (event) => cb(mutable(event.event)))
      void invoke("WslSubscribe")
      return () => {
        dispose()
        void invoke("WslUnsubscribe")
      }
    },
    probeRuntime: () => invoke("WslProbeRuntime"),
    refreshDistros: () => invoke("WslRefreshDistros"),
    installWsl: () => invoke("WslInstallWsl"),
    installDistro: (name) => invoke("WslInstallDistro", { name }),
    probeAddable: (distros) => invoke("WslProbeAddable", { distros }),
    installOpencode: (name) => invoke("WslInstallOpencode", { name }),
    openTerminal: (name) => invoke("WslOpenTerminal", { name }),
    addServer: (distro) => invoke("WslAddServer", { distro }),
    removeServer: (id) => invoke("WslRemoveServer", { id }),
    startServer: (id) => invoke("WslStartServer", { id }),
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        updaterListener = listen("UpdaterStateChanged", (event) => updaterHandler(mutable(event.state)))
        updaterSubscription = invoke("UpdaterSubscribe")
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        updaterListener?.()
        updaterListener = undefined
        updaterSubscription = undefined
        void invoke("UpdaterUnsubscribe")
      }
    },
    check: () => invoke("UpdaterCheck"),
    install: () => invoke("UpdaterInstall"),
  },
  consumeInitialDeepLinks: () => invoke("AppConsumeInitialDeepLinks").then(mutable),
  getDefaultServerUrl: () => invoke("AppGetDefaultServerUrl"),
  setDefaultServerUrl: (url) => invoke("AppSetDefaultServerUrl", { url }),
  isFirstLaunchOnboardingPending: () => invoke("AppIsFirstLaunchOnboardingPending"),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    invoke("AppFinishFirstLaunchOnboarding", { createDefaultProject }),
  checkAppExists: (appName) => invoke("AppCheckAppExists", { appName }),
  resolveAppPath: (appName) => invoke("AppResolveAppPath", { appName }),
  storeGet: (name, key) => invoke("StorageGet", { name, key }),
  storeSet: (name, key, value) => invoke("StorageSet", { name, key, value }),
  storeDelete: (name, key) => invoke("StorageDelete", { name, key }),
  storeClear: (name) => invoke("StorageClear", { name }),
  storeKeys: (name) => invoke("StorageKeys", { name }).then(mutable),
  storeLength: (name) => invoke("StorageLength", { name }),
  draftGet: (key) => invoke("DraftsGet", { key }),
  draftSet: (key, value) => invoke("DraftsSet", { key, value }),
  draftDelete: (key) => invoke("DraftsDelete", { key }),
  draftBlobPut: (data) => invoke("DraftsPutBlob", { data: new Uint8Array(data) }),
  draftBlobGet: (id) => invoke("DraftsGetBlob", { id }).then((data) => (data ? toArrayBuffer(data) : null)),

  getWindowID: () => invoke("WindowGetId"),
  themeReady: () => invoke("WindowThemeReady"),
  onMenuCommand: (cb) => listen("MenuCommandTriggered", (event) => cb(event.id)),
  onDeepLink: (cb) => listen("DeepLinksOpened", (event) => cb(mutable(event.urls))),

  openDirectoryPicker: (opts) => invoke("FilesOpenDirectoryPicker", { options: opts }).then(mutable),
  openFilePicker: (opts) => invoke("FilesOpenFilePicker", { options: opts }).then(mutable),
  readPickedFile: (token, path) => invoke("FilesReadPickedFile", { token, path }).then(toArrayBuffer),
  releasePickedFiles: (token) => invoke("FilesReleasePickedFiles", { token }),
  getPathForFile: (file) => window.electron.getPathForFile(file),
  saveFilePicker: (opts) => invoke("FilesSaveFilePicker", { options: opts }),
  openExternal: (url) => send("FilesOpenExternal", { url }),
  openLocalFile: (url) => send("FilesOpenLocalFile", { url }),
  openPath: (path, app) => invoke("FilesOpenPath", { path, application: app }).then((value) => value ?? undefined),
  revealPath: (path) => invoke("FilesRevealPath", { path }),
  readClipboardImage: () =>
    invoke("FilesReadClipboardImage").then((image) =>
      image ? { ...image, buffer: toArrayBuffer(image.buffer) } : null,
    ),
  getWindowFocused: () => invoke("WindowGetFocused"),
  getWindowFullscreen: () => invoke("WindowGetFullscreen"),
  onWindowFullscreenChanged: (cb) => listen("WindowFullscreenChanged", (event) => cb(event.fullscreen)),
  setWindowFocus: () => invoke("WindowSetFocus"),
  showWindow: () => invoke("WindowShow"),
  relaunch: () => send("AppRelaunch"),
  getZoomFactor: () => invoke("WindowGetZoomFactor"),
  setZoomFactor: (factor) => invoke("WindowSetZoomFactor", { factor }),
  getPinchZoomEnabled: () => invoke("WindowGetPinchZoomEnabled"),
  setPinchZoomEnabled: (enabled) => invoke("WindowSetPinchZoomEnabled", { enabled }),
  onPinchZoomEnabledChanged: (cb) => listen("WindowPinchZoomChanged", (event) => cb(event.enabled)),
  onZoomFactorChanged: (cb) => listen("WindowZoomChanged", (event) => cb(event.factor)),
  setTitlebar: (theme) => invoke("WindowSetTitlebar", { theme }),
  runDesktopMenuAction: (action) => invoke("MenuRunAction", { action }),
  setBackgroundColor: (color) => invoke("AppSetBackgroundColor", { color }),
  exportDebugLogs: () => invoke("AppExportDebugLogs"),
  setForceFocus: (enabled) => invoke("AppSetForceFocus", { enabled }),
  recordFatalRendererError: (error) => invoke("AppRecordFatalRendererError", { error }),
  setNativeTranslations: (bundle) => invoke("AppSetNativeTranslations", { value: bundle }),
}
