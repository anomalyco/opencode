import { execFile } from "node:child_process"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"

import type {
  InitStep,
  FatalRendererError,
  ServerReadyData,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
} from "../preload/types"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import {
  abortExtraAgentTest,
  listExtraAgentServers,
  testGenericagentBridge,
  testHermesBridge,
  testOpenclawBridge,
} from "./extra-agents"
import { getStore } from "./store"
import { getPinchZoomEnabled, setPinchZoomEnabled, setTitlebar, updateTitlebar } from "./windows"
import {
  createConfigFile,
  detectOpenclawConfig,
  filterDirectories,
  getConfigWorkspace,
  getCustomEditorPath,
  getDefaultEditor,
  getGenericagentConfig,
  getHermesConfig,
  getOpenclawConfig,
  installCli,
  listConfigDirectory,
  listConfigFiles,
  listLocalDirectory,
  listTrellisTasks,
  openInEditor,
  openInFinder,
  readConfigFile,
  setCustomEditorPath,
  setDefaultEditor,
  setGenericagentConfig,
  setHermesConfig,
  setOpenclawConfig,
  writeConfigFile,
} from "./native"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

type Deps = {
  killSidecar: () => Promise<void> | void
  reloadBackend: () => Promise<void> | void
  awaitInitialization: (sendStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig> | WindowConfig
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void> | void
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  parseMarkdown: (markdown: string) => Promise<string> | string
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void> | void
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
}

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("install-cli", () => installCli())
  ipcMain.handle("reload-backend", () => deps.reloadBackend())
  ipcMain.handle("await-initialization", (event: IpcMainInvokeEvent) => {
    const send = (step: InitStep) => event.sender.send("init-step", step)
    return deps.awaitInitialization(send)
  })
  ipcMain.handle("get-window-config", () => deps.getWindowConfig())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("get-wsl-config", () => deps.getWslConfig())
  ipcMain.handle("set-wsl-config", (_event: IpcMainInvokeEvent, config: WslConfig) => deps.setWslConfig(config))
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("parse-markdown", (_event: IpcMainInvokeEvent, markdown: string) => deps.parseMarkdown(markdown))
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("wsl-path", (_event: IpcMainInvokeEvent, path: string, mode: "windows" | "linux" | null) =>
    deps.wslPath(path, mode),
  )
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  ipcMain.on("loading-window-complete", () => deps.loadingWindowComplete())
  ipcMain.handle("run-updater", (_event: IpcMainInvokeEvent, alertOnFail: boolean) => deps.runUpdater(alertOnFail))
  ipcMain.handle("check-update", () => deps.checkUpdate())
  ipcMain.handle("install-update", () => deps.installUpdate())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("export-debug-logs", () => deps.exportDebugLogs())
  ipcMain.handle("record-fatal-renderer-error", (_event: IpcMainInvokeEvent, error: FatalRendererError) =>
    deps.recordFatalRendererError(error),
  )
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
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? "Choose a folder",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (
      _event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; accept?: string[]; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? "Choose a file",
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? "Save file",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  ipcMain.on("open-link", (_event: IpcMainEvent, url: string) => {
    void shell.openExternal(url)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })
  ipcMain.handle("open-in-finder", (_event: IpcMainInvokeEvent, path: string) => openInFinder(path))
  ipcMain.handle("open-in-editor", (_event: IpcMainInvokeEvent, editor: string, path: string) =>
    openInEditor(editor, path),
  )
  ipcMain.handle("get-custom-editor-path", () => getCustomEditorPath())
  ipcMain.handle("set-custom-editor-path", (_event: IpcMainInvokeEvent, path: string | null) =>
    setCustomEditorPath(path),
  )
  ipcMain.handle("get-default-editor", () => getDefaultEditor())
  ipcMain.handle("set-default-editor", (_event: IpcMainInvokeEvent, editor: string | null) =>
    setDefaultEditor(editor),
  )
  ipcMain.handle("filter-directories", (_event: IpcMainInvokeEvent, paths: string[]) => filterDirectories(paths))
  ipcMain.handle("list-config-files", (_event: IpcMainInvokeEvent, directory?: string | null) =>
    listConfigFiles(directory),
  )
  ipcMain.handle("read-config-file", (_event: IpcMainInvokeEvent, path: string) => readConfigFile(path))
  ipcMain.handle("write-config-file", (_event: IpcMainInvokeEvent, path: string, content: string) =>
    writeConfigFile(path, content),
  )
  ipcMain.handle("create-config-file", (_event: IpcMainInvokeEvent, path: string, content: string) =>
    createConfigFile(path, content),
  )
  ipcMain.handle("get-config-workspace", () => getConfigWorkspace())
  ipcMain.handle("list-config-directory", (_event: IpcMainInvokeEvent, path: string) => listConfigDirectory(path))
  ipcMain.handle("list-local-directory", (_event: IpcMainInvokeEvent, path: string) => listLocalDirectory(path))
  ipcMain.handle("list-trellis-tasks", (_event: IpcMainInvokeEvent, directory: string) => listTrellisTasks(directory))
  ipcMain.handle("get-openclaw-config", () => getOpenclawConfig())
  ipcMain.handle("set-openclaw-config", (_event: IpcMainInvokeEvent, config) => setOpenclawConfig(config))
  ipcMain.handle("test-openclaw-config", (_event: IpcMainInvokeEvent, config) => testOpenclawBridge(config))
  ipcMain.handle("detect-openclaw-config", () => detectOpenclawConfig())
  ipcMain.handle("abort-openclaw-test", () => abortExtraAgentTest("openclaw"))
  ipcMain.handle("get-genericagent-config", () => getGenericagentConfig())
  ipcMain.handle("set-genericagent-config", (_event: IpcMainInvokeEvent, config) => setGenericagentConfig(config))
  ipcMain.handle("test-genericagent-config", (_event: IpcMainInvokeEvent, config) => testGenericagentBridge(config))
  ipcMain.handle("abort-genericagent-test", () => abortExtraAgentTest("genericagent"))
  ipcMain.handle("get-hermes-config", () => getHermesConfig())
  ipcMain.handle("set-hermes-config", (_event: IpcMainInvokeEvent, config) => setHermesConfig(config))
  ipcMain.handle("test-hermes-config", (_event: IpcMainInvokeEvent, config) => testHermesBridge(config))
  ipcMain.handle("abort-hermes-test", () => abortExtraAgentTest("hermes"))
  ipcMain.handle("list-extra-agent-servers", () => listExtraAgentServers())

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  ipcMain.on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body }).show()
  })

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
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
    app.relaunch()
    app.exit(0)
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
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action)
  })

  ipcMain.handle(
    "fetch-external",
    async (
      _event: IpcMainInvokeEvent,
      url: string,
      options?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
      return new Promise<{ ok: boolean; status: number; statusText: string; body: string }>((resolve, reject) => {
        const urlObj = new URL(url)
        const isHttps = urlObj.protocol === "https:"
        const lib = isHttps ? require("https") : require("http")

        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: options?.method || "GET",
          headers: options?.headers || {},
        }

        const req = lib.request(reqOptions, (res: any) => {
          let body = ""
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString()
          })
          res.on("end", () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage || "",
              body,
            })
          })
        })

        req.on("error", (err: Error) => {
          reject(err)
        })

        if (options?.body) {
          req.write(options.body)
        }

        req.end()
      })
    },
  )
}

export function sendSqliteMigrationProgress(win: BrowserWindow, progress: SqliteMigrationProgress) {
  win.webContents.send("sqlite-migration-progress", progress)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
