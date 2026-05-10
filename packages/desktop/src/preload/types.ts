import type {
  BrowserAnnotationData,
  BrowserAnnotationDetail,
  BrowserConsoleLevel,
  BrowserConsoleReadResult,
  BrowserDialogAction,
  BrowserDialogResult,
  BrowserDownload,
  BrowserInspectResult,
  BrowserRunCodeResult,
  BrowserSnapshot,
} from "../main/browser/types"

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

export type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserNavigationState = {
  url: string
  title: string
}

export type BrowserState = {
  visible: boolean
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  inspectMode: boolean
}

export type BrowserLifecycleEntry = {
  id: string
  title: string
  url: string
  state?: BrowserState
}

export type BrowserLifecycleState = {
  activeBrowserId?: string
  browsers: BrowserLifecycleEntry[]
}

export type BrowserCreateParams = {
  bounds?: BrowserBounds
  url?: string
}

export type BrowserCreateResult = {
  browser: BrowserLifecycleEntry
  state: BrowserLifecycleState
}

export type BrowserLifecycleResult = {
  success: boolean
  state: BrowserLifecycleState
}

export type BrowserConsoleMessagesParams = {
  browserId?: string
  levels?: BrowserConsoleLevel[]
  limit?: number
}

export type BrowserConsoleClearParams = {
  browserId?: string
}

export type BrowserConsoleClearResult = {
  browserId: string
  count: number
}

export type BrowserAPI = {
  setBounds: (bounds: BrowserBounds, browserId?: string) => void
  show: (browserId?: string) => void
  hide: (browserId?: string) => void
  attach: (browserId?: string) => void
  setActiveBrowser: (browserId: string) => Promise<BrowserLifecycleResult>
  createBrowser: (params?: BrowserCreateParams) => Promise<BrowserCreateResult>
  closeBrowser: (browserId: string) => Promise<BrowserLifecycleResult>
  open: () => Promise<BrowserState>
  onOpenRequested: (cb: () => void) => () => void
  navigate: (url: string) => Promise<BrowserNavigationState>
  back: () => Promise<BrowserNavigationState>
  forward: () => Promise<BrowserNavigationState>
  reload: () => Promise<void>
  clearData: () => Promise<void>
  clearAnnotationMarkers: () => Promise<void>
  getConsoleMessages: (params?: BrowserConsoleMessagesParams) => Promise<BrowserConsoleReadResult>
  clearConsoleMessages: (params?: BrowserConsoleClearParams) => Promise<BrowserConsoleClearResult>
  getState: () => Promise<BrowserState>
  screenshot: () => Promise<string | null>
  startInspectMode: () => Promise<BrowserInspectResult | null>
  stopInspectMode: () => Promise<void>
  getAnnotationData: (selector: string) => Promise<BrowserAnnotationData | null>
  toolClick: (selector: string) => Promise<void>
  toolOpenBrowserPage: (browserId?: string) => Promise<BrowserState>
  toolNavigatePage: (url: string, browserId?: string) => Promise<BrowserNavigationState>
  toolReadPage: (browserId?: string) => Promise<BrowserSnapshot>
  toolScreenshotPage: (browserId?: string) => Promise<string | null>
  toolClickElement: (selector: string, browserId?: string) => Promise<void>
  toolConsoleMessages: (params?: BrowserConsoleMessagesParams) => Promise<BrowserConsoleReadResult>
  toolConsoleClear: (params?: BrowserConsoleClearParams) => Promise<BrowserConsoleClearResult>
  toolTypeInPage: (selector: string, text: string, browserId?: string) => Promise<void>
  toolHover: (selector: string, browserId?: string) => Promise<boolean | undefined>
  toolDrag: (selector: string, targetSelector: string, browserId?: string) => Promise<boolean>
  toolHandleDialog: (action: BrowserDialogAction, promptText?: string, browserId?: string) => Promise<BrowserDialogResult>
  toolRunBrowserCode: (code: string, browserId?: string) => Promise<BrowserRunCodeResult>
  toolRunPlaywrightCode: (code: string, browserId?: string) => Promise<BrowserRunCodeResult>
  toolType: (selector: string, text: string) => Promise<void>
  toolPress: (key: string) => Promise<void>
  toolUploadFile: (selector: string, fileRef: string, workspaceRoot?: string) => Promise<void>
  toolListDownloads: () => Promise<BrowserDownload[]>
  toolGetAnnotationDetail: (id: string) => Promise<BrowserAnnotationDetail | null>
  storeAnnotationDetail: (id: string, detail: BrowserAnnotationDetail) => Promise<void>
  toolInspect: {
    (): Promise<BrowserSnapshot>
    (selector: string): Promise<BrowserAnnotationData | null>
  }
  toolGetSnapshot: () => Promise<BrowserSnapshot>
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
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
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  browser: BrowserAPI
}
