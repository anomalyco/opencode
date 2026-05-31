import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ElectronAPI, InitStep, SqliteMigrationProgress } from "./types"

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  reloadBackend: () => ipcRenderer.invoke("reload-backend"),
  awaitInitialization: (onStep) => {
    const handler = (_: unknown, step: InitStep) => onStep(step)
    ipcRenderer.on("init-step", handler)
    return ipcRenderer.invoke("await-initialization").finally(() => {
      ipcRenderer.removeListener("init-step", handler)
    })
  },
  getWindowConfig: () => ipcRenderer.invoke("get-window-config"),
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  onSqliteMigrationProgress: (cb) => {
    const handler = (_: unknown, progress: SqliteMigrationProgress) => cb(progress)
    ipcRenderer.on("sqlite-migration-progress", handler)
    return () => ipcRenderer.removeListener("sqlite-migration-progress", handler)
  },
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  openInFinder: (path) => ipcRenderer.invoke("open-in-finder", path),
  openInEditor: (editor, path) => ipcRenderer.invoke("open-in-editor", editor, path),
  getCustomEditorPath: () => ipcRenderer.invoke("get-custom-editor-path"),
  setCustomEditorPath: (path) => ipcRenderer.invoke("set-custom-editor-path", path),
  getDefaultEditor: () => ipcRenderer.invoke("get-default-editor"),
  setDefaultEditor: (editor) => ipcRenderer.invoke("set-default-editor", editor),
  filterDirectories: (paths) => ipcRenderer.invoke("filter-directories", paths),
  listConfigFiles: (directory) => ipcRenderer.invoke("list-config-files", directory),
  readConfigFile: (path) => ipcRenderer.invoke("read-config-file", path),
  writeConfigFile: (path, content) => ipcRenderer.invoke("write-config-file", path, content),
  createConfigFile: (path, content) => ipcRenderer.invoke("create-config-file", path, content),
  getConfigWorkspace: () => ipcRenderer.invoke("get-config-workspace"),
  listConfigDirectory: (path) => ipcRenderer.invoke("list-config-directory", path),
  listLocalDirectory: (path) => ipcRenderer.invoke("list-local-directory", path),
  listTrellisTasks: (directory) => ipcRenderer.invoke("list-trellis-tasks", directory),
  getOpenclawConfig: () => ipcRenderer.invoke("get-openclaw-config"),
  setOpenclawConfig: (config) => ipcRenderer.invoke("set-openclaw-config", config),
  testOpenclawConfig: (config) => ipcRenderer.invoke("test-openclaw-config", config),
  detectOpenclawConfig: () => ipcRenderer.invoke("detect-openclaw-config"),
  abortOpenclawTest: () => ipcRenderer.invoke("abort-openclaw-test"),
  getGenericagentConfig: () => ipcRenderer.invoke("get-genericagent-config"),
  setGenericagentConfig: (config) => ipcRenderer.invoke("set-genericagent-config", config),
  testGenericagentConfig: (config) => ipcRenderer.invoke("test-genericagent-config", config),
  abortGenericagentTest: () => ipcRenderer.invoke("abort-genericagent-test"),
  getHermesConfig: () => ipcRenderer.invoke("get-hermes-config"),
  setHermesConfig: (config) => ipcRenderer.invoke("set-hermes-config", config),
  testHermesConfig: (config) => ipcRenderer.invoke("test-hermes-config", config),
  abortHermesTest: () => ipcRenderer.invoke("abort-hermes-test"),
  listExtraAgentServers: () => ipcRenderer.invoke("list-extra-agent-servers"),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  getPinchZoomEnabled: () => ipcRenderer.invoke("get-pinch-zoom-enabled"),
  setPinchZoomEnabled: (enabled) => ipcRenderer.invoke("set-pinch-zoom-enabled", enabled),
  onPinchZoomEnabledChanged: (cb) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on("pinch-zoom-enabled-changed", handler)
    return () => ipcRenderer.removeListener("pinch-zoom-enabled-changed", handler)
  },
  onZoomFactorChanged: (cb) => {
    const handler = (_: unknown, factor: number) => cb(factor)
    ipcRenderer.on("zoom-factor-changed", handler)
    return () => ipcRenderer.removeListener("zoom-factor-changed", handler)
  },
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runDesktopMenuAction: (action) => ipcRenderer.invoke("run-desktop-menu-action", action),
  loadingWindowComplete: () => ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  exportDebugLogs: () => ipcRenderer.invoke("export-debug-logs"),
  recordFatalRendererError: (error) => ipcRenderer.invoke("record-fatal-renderer-error", error),
  fetchExternal: (url, options) => ipcRenderer.invoke("fetch-external", url, options),
}

contextBridge.exposeInMainWorld("api", api)

function filePaths(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  return files.map((file) => webUtils.getPathForFile(file)).filter((path) => path.length > 0)
}

function emitDragDrop(type: "enter" | "leave" | "drop", event: DragEvent) {
  const paths = filePaths(event)
  window.dispatchEvent(
    new CustomEvent("opencode:drag-drop", {
      detail: {
        type,
        paths,
        position: { x: event.clientX, y: event.clientY },
      },
    }),
  )
}

window.addEventListener("dragover", (event) => {
  event.preventDefault()
})
window.addEventListener("dragenter", (event) => {
  event.preventDefault()
  emitDragDrop("enter", event)
})
window.addEventListener("dragleave", (event) => {
  event.preventDefault()
  emitDragDrop("leave", event)
})
window.addEventListener("drop", (event) => {
  event.preventDefault()
  emitDragDrop("drop", event)
})
