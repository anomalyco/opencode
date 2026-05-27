/**
 * NativeIPCProtocol — 平台无关的原生能力接口
 *
 * macOS 通过 WKScriptMessageHandler 实现
 * Windows 通过 WebView2 WebMessageReceived 实现
 * Web 开发模式通过浏览器 API polyfill 实现
 */

export type FilePickerOptions = {
  multiple?: boolean
  title?: string
  defaultPath?: string
  extensions?: string[]
}

export type SavePickerOptions = {
  title?: string
  defaultPath?: string
}

export type DirectoryPickerOptions = {
  multiple?: boolean
  title?: string
  defaultPath?: string
}

export type ClipboardImage = {
  buffer: ArrayBuffer
  width: number
  height: number
}

export type NotificationLevel = "info" | "success" | "warning" | "error"

export type SqliteMigrationProgress =
  | { type: "InProgress"; value: number }
  | { type: "Done" }

export type InitStep =
  | { phase: "server_waiting" }
  | { phase: "sqlite_waiting" }
  | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type NativeIPCProtocol = {
  // Server lifecycle
  killSidecar(): Promise<void>
  awaitInitialization(onStep: (step: InitStep) => void): Promise<ServerReadyData>
  getDefaultServerUrl(): Promise<string | null>
  setDefaultServerUrl(url: string | null): Promise<void>

  // File dialogs
  openFilePicker(opts?: FilePickerOptions): Promise<string | string[] | null>
  openDirectoryPicker(opts?: DirectoryPickerOptions): Promise<string | string[] | null>
  saveFilePicker(opts?: SavePickerOptions): Promise<string | null>

  // Clipboard
  readClipboardImage(): Promise<ClipboardImage | null>

  // Window
  getWindowFocused(): Promise<boolean>
  setWindowFocus(): Promise<void>
  showWindow(): Promise<void>
  getZoomFactor(): Promise<number>
  setZoomFactor(factor: number): Promise<void>

  // System
  openLink(url: string): void
  openPath(path: string, app?: string): Promise<void>
  showNotification(title: string, body?: string, level?: NotificationLevel, action?: string): void
  showProgressNotification(title: string, step: number, totalSteps: number, currentStep: string): void
  relaunch(): void

  // Store
  storeGet(name: string, key: string): Promise<string | null>
  storeSet(name: string, key: string, value: string): Promise<void>
  storeDelete(name: string, key: string): Promise<void>
  storeClear(name: string): Promise<void>
  storeKeys(name: string): Promise<string[]>
  storeLength(name: string): Promise<number>

  // Events
  onSqliteMigrationProgress(cb: (progress: SqliteMigrationProgress) => void): () => void
  onMenuCommand(cb: (id: string) => void): () => void
}
