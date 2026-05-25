import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"

export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

export type WslConfig = { enabled: boolean }

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
}
export type WindowConfig = {
  updaterEnabled: boolean
}

export type ConfigFile = {
  id: string
  label: string
  path: string
  exists: boolean
  scope: string
  kind: string
}

export type ConfigWorkspaceFile = {
  name: string
  path: string
  kind: string
}

export type ConfigWorkspace = {
  configRoot?: string
  agentsRoot?: string
  skillsRoot?: string
  pluginsRoot?: string
  agentsMdPath?: string
  agents: ConfigWorkspaceFile[]
  plugins: ConfigWorkspaceFile[]
}

export type ConfigTreeItem = {
  path: string
  kind: "file" | "directory"
}

export type TrellisTask = {
  id: string
  name: string
  title: string
  status: string
  priority?: string
  assignee?: string
  package?: string
  parent?: string
  children: string[]
  createdAt?: string
  completedAt?: string
  path: string
  current: boolean
}

export type TrellisTaskList = {
  root: string
  current?: string
  skipped?: number
  tasks: TrellisTask[]
}

export type OpenclawConfig = {
  enabled: boolean
  url?: string
  token?: string
}

export type OpenclawTest = {
  ok: boolean
  logs: string[]
}

export type OpenclawDetection = {
  ok: boolean
  config?: OpenclawConfig
  source?: string
  logs: string[]
}

export type GenericagentConfig = {
  enabled: boolean
  pythonExecutable?: string
  genericAgentDir?: string
}

export type GenericagentTest = {
  ok: boolean
  logs: string[]
}

export type HermesConfig = {
  enabled: boolean
  pythonExecutable?: string
  hermesDir?: string
  hermesHome?: string
}

export type HermesTest = {
  ok: boolean
  logs: string[]
}

export type ExtraAgentId = "openclaw" | "hermes" | "genericagent"

export type ExtraAgentServer = {
  id: ExtraAgentId
  url: string
  username?: string | null
  password?: string | null
}

export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  reloadBackend: () => Promise<void>
  awaitInitialization: (onStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig>
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>

  getWindowCount: () => Promise<number>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    accept?: string[]
    extensions?: string[]
  }) => Promise<string | string[] | null>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  openInFinder: (path: string) => Promise<void>
  openInEditor: (editor: string, path: string) => Promise<void>
  getCustomEditorPath: () => Promise<string | null>
  setCustomEditorPath: (path: string | null) => Promise<void>
  getDefaultEditor: () => Promise<string | null>
  setDefaultEditor: (editor: string | null) => Promise<void>
  filterDirectories: (paths: string[]) => Promise<string[]>
  listConfigFiles: (directory?: string | null) => Promise<ConfigFile[]>
  readConfigFile: (path: string) => Promise<string | null>
  writeConfigFile: (path: string, content: string) => Promise<void>
  createConfigFile: (path: string, content: string) => Promise<void>
  getConfigWorkspace: () => Promise<ConfigWorkspace>
  listConfigDirectory: (path: string) => Promise<ConfigTreeItem[]>
  listLocalDirectory: (path: string) => Promise<ConfigTreeItem[]>
  listTrellisTasks: (directory: string) => Promise<TrellisTaskList>
  getOpenclawConfig: () => Promise<OpenclawConfig>
  setOpenclawConfig: (config: OpenclawConfig) => Promise<void>
  testOpenclawConfig: (config: OpenclawConfig) => Promise<OpenclawTest>
  detectOpenclawConfig: () => Promise<OpenclawDetection>
  abortOpenclawTest: () => Promise<boolean>
  getGenericagentConfig: () => Promise<GenericagentConfig>
  setGenericagentConfig: (config: GenericagentConfig) => Promise<void>
  testGenericagentConfig: (config: GenericagentConfig) => Promise<GenericagentTest>
  abortGenericagentTest: () => Promise<boolean>
  getHermesConfig: () => Promise<HermesConfig>
  setHermesConfig: (config: HermesConfig) => Promise<void>
  testHermesConfig: (config: HermesConfig) => Promise<HermesTest>
  abortHermesTest: () => Promise<boolean>
  listExtraAgentServers: () => Promise<ExtraAgentServer[]>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
}
