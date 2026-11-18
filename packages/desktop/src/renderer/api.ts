import type { ElectronAPI } from "./api-types"
import { cancellable, invoke, listen, send } from "./ipc-client"

type Mutable<Value> =
  Value extends ReadonlyArray<unknown>
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value extends object
      ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
      : Value

// SAFETY: IPC replies are fresh structured clones owned by the caller, so dropping the schema's readonly markers
// cannot alias shared state.
const mutable = <Value>(value: Value) => value as Mutable<Value>

// SAFETY: IPC bytes arrive in a structured-cloned Uint8Array over an ordinary ArrayBuffer, never a
// SharedArrayBuffer, so slicing its buffer yields an ArrayBuffer.
const toArrayBuffer = (value: Uint8Array) =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer

export const api: ElectronAPI = {
  awaitInitialization: () => invoke("AppAwaitInitialization"),
  reconnectService: (signal) => cancellable("AppReconnectService", undefined, signal),
  onSidecarChanged: (cb) => listen("SidecarChanged", (event) => cb({ url: event.url })),
  readyDeepLinks: () => send("AppReadyDeepLinks"),
  acknowledgeDeepLinks: (attempt) => send("AppAcknowledgeDeepLinks", { attempt }),
  isFirstLaunchOnboardingPending: () => invoke("AppIsFirstLaunchOnboardingPending"),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    invoke("AppFinishFirstLaunchOnboarding", { createDefaultProject }),
  checkAppExists: (appName) => invoke("AppCheckAppExists", { appName }),
  resolveAppPath: (appName) => invoke("AppResolveAppPath", { appName }),
  getStorageSnapshot: () => window.electron.storageSnapshot,
  storeItems: (name) => invoke("StorageItems", { name }).then(mutable),
  storeUpdate: (name, insert, remove) => invoke("StorageUpdate", { name, insert, remove }),
  storeClear: (name) => invoke("StorageClear", { name }),
  onStoreChanged: (cb) =>
    listen("StorageChanged", (event) => cb(event.name, mutable(event.insert), mutable(event.remove), event.revision)),
  draftGet: (key) => invoke("DraftsGet", { key }),
  draftSet: (key, value, strict) => invoke("DraftsSet", { key, value, strict }).then(mutable),
  draftDelete: (key) => invoke("DraftsDelete", { key }),
  draftBlobPut: (data) => invoke("DraftsPutBlob", { data: new Uint8Array(data) }),
  draftBlobGet: (id) => invoke("DraftsGetBlob", { id }).then((data) => (data ? toArrayBuffer(data) : null)),

  getWindowID: () => window.electron.windowID,
  getWindowBootstrap: () => window.electron.bootstrap,
  themeReady: () => invoke("WindowThemeReady"),
  onMenuCommand: (cb) => listen("MenuCommandTriggered", (event) => cb(event.id)),
  onDeepLink: (cb) => listen("DeepLinksOpened", (event) => cb({ attempt: event.attempt, urls: mutable(event.urls) })),

  openDirectoryPicker: (opts) => invoke("FilesOpenDirectoryPicker", { options: opts }).then(mutable),
  openFilePicker: (opts) => invoke("FilesOpenFilePicker", { options: opts }).then(mutable),
  readPickedFile: (token, path) => invoke("FilesReadPickedFile", { token, path }).then(toArrayBuffer),
  releasePickedFiles: (token) => invoke("FilesReleasePickedFiles", { token }),
  getPathForFile: (file) => window.electron.getPathForFile(file),
  saveFile: (opts, content) => invoke("FilesSaveFile", { options: opts, content }),
  openExternal: (url) => send("FilesOpenExternal", { url }),
  openBrowser: (url) => invoke("FilesOpenBrowser", { url }),
  openLocalFile: (url) => send("FilesOpenLocalFile", { url }),
  openPath: (path, app) => invoke("FilesOpenPath", { path, application: app }).then((value) => value ?? undefined),
  revealPath: (path) => invoke("FilesRevealPath", { path }),
  readClipboardImage: () =>
    invoke("FilesReadClipboardImage").then((image) =>
      image ? { ...image, buffer: toArrayBuffer(image.buffer) } : null,
    ),
  writeClipboardText: (text) => invoke("FilesWriteClipboardText", { text }),
  getWindowFocused: () => invoke("WindowGetFocused"),
  requestMicrophone: () => invoke("WindowRequestMicrophone"),
  setVoiceCallActive: (active) => invoke("WindowSetVoiceCallActive", { active }),
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
  getZoomLevel: () => invoke("WindowGetZoomLevel"),
  setZoomLevel: (level) => invoke("WindowSetZoomLevel", { level }),
  onZoomChanged: (cb) => listen("WindowZoomChanged", (event) => cb({ factor: event.factor, level: event.level })),
  setTitlebar: (theme) => invoke("WindowSetTitlebar", { theme }),
  setTrafficLightsPosition: (position) => invoke("WindowSetTrafficLightsPosition", position),
  runDesktopMenuAction: (action) => invoke("MenuRunAction", { action }),
  setBackgroundColor: (color) => invoke("AppSetBackgroundColor", { color }),
  exportDebugLogs: () => invoke("AppExportDebugLogs"),
  setForceFocus: (enabled) => invoke("AppSetForceFocus", { enabled }),
  getSpellcheckEnabled: () => invoke("AppGetSpellcheckEnabled"),
  setSpellcheckEnabled: (enabled) => invoke("AppSetSpellcheckEnabled", { enabled }),
  recordFatalRendererError: (error) => invoke("AppRecordFatalRendererError", { error }),
  setNativeTranslations: (bundle) => invoke("AppSetNativeTranslations", { value: bundle }),
}
