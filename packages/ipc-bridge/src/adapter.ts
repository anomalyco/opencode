import type {
  ClipboardImage,
  DirectoryPickerOptions,
  FilePickerOptions,
  InitStep,
  NativeIPCProtocol,
  SavePickerOptions,
  ServerReadyData,
  SqliteMigrationProgress,
} from "./protocol"

/**
 * 创建平台适配的 NativeAPI 实例
 *
 * 在原生壳（WKWebView / WebView2）中，原生侧注入 bridge 对象
 * 在 Web 开发模式中，使用浏览器 API 的 polyfill fallback
 */
export function createNativeAPI(): NativeIPCProtocol {
  if (isNativeShell()) {
    return new NativeBridgeAdapter()
  }
  return new WebFallbackAdapter()
}

function isNativeShell(): boolean {
  const native = (window as { __YUNPAT_NATIVE__?: { postMessage?: (payload: string) => void } }).__YUNPAT_NATIVE__
  return !!(native && typeof native.postMessage === "function")
}

type MacClipboardPayload = { data: string; type: string }

/**
 * 原生壳注入的 bridge 适配器
 */
class NativeBridgeAdapter implements NativeIPCProtocol {
  private bridge: { postMessage: (payload: string) => void }
  private pendingCalls: Map<number, { resolve: Function; reject: Function }> = new Map()
  private nextId = 0
  private sqliteListeners: Set<(progress: SqliteMigrationProgress) => void> = new Set()
  private menuListeners: Set<(id: string) => void> = new Set()

  constructor() {
    const native = (window as { __YUNPAT_NATIVE__?: { postMessage: (payload: string) => void } }).__YUNPAT_NATIVE__
    if (!native?.postMessage) {
      throw new Error("YunPat：未找到原生 bridge（__YUNPAT_NATIVE__.postMessage）")
    }
    this.bridge = native
    this.setupEventListeners()
  }

  private setupEventListeners() {
    document.addEventListener("yunpat-event", (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        type: string
        data: { callId: number; result?: unknown; error?: string }
      }
      const { type, data } = detail
      if (type === "resolve" || type === "reject") {
        const pending = this.pendingCalls.get(data.callId)
        if (!pending) return
        this.pendingCalls.delete(data.callId)
        if (type === "resolve") pending.resolve(data.result)
        else pending.reject(new Error(data.error ?? "native error"))
      } else if (type === "sqlite-migration-progress") {
        this.sqliteListeners.forEach((cb) => cb(data as unknown as SqliteMigrationProgress))
      } else if (type === "menu-command") {
        this.menuListeners.forEach((cb) => cb(String(data)))
      }
    })
  }

  private call(method: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const callId = this.nextId++
      this.pendingCalls.set(callId, { resolve, reject })
      this.bridge.postMessage(JSON.stringify({ callId, method, args }))
    })
  }

  async killSidecar() {
    await this.call("killSidecar")
  }

  async awaitInitialization(onStep: (step: InitStep) => void): Promise<ServerReadyData> {
    const injected = (window as { __YUNPAT_SERVER_URL__?: string }).__YUNPAT_SERVER_URL__
    if (injected) {
      onStep({ phase: "done" })
      return { url: injected, username: null, password: null }
    }
    return (await this.call("awaitInitialization", onStep)) as ServerReadyData
  }

  async getDefaultServerUrl() {
    return this.call("getDefaultServerUrl") as Promise<string | null>
  }

  async setDefaultServerUrl(url: string | null) {
    await this.call("setDefaultServerUrl", url)
  }

  async openFilePicker(opts?: FilePickerOptions) {
    return (await this.call("openFilePicker", opts)) as string | string[] | null
  }

  async openDirectoryPicker(opts?: DirectoryPickerOptions) {
    return (await this.call("openDirectoryPicker", opts)) as string | string[] | null
  }

  async saveFilePicker(opts?: SavePickerOptions) {
    return (await this.call("saveFilePicker", opts)) as string | null
  }

  async readClipboardImage(): Promise<ClipboardImage | null> {
    const result = (await this.call("readClipboardImage")) as MacClipboardPayload | ClipboardImage | null
    if (!result) return null
    if ("buffer" in result && result.buffer instanceof ArrayBuffer) {
      return result
    }
    if ("data" in result && typeof result.data === "string") {
      const binary = atob(result.data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return { buffer: bytes.buffer, width: 0, height: 0 }
    }
    return null
  }

  async getWindowFocused() {
    return this.call("getWindowFocused") as Promise<boolean>
  }

  async setWindowFocus() {
    await this.call("setWindowFocus")
  }

  async showWindow() {
    await this.call("showWindow")
  }

  async getZoomFactor() {
    return this.call("getZoomFactor") as Promise<number>
  }

  async setZoomFactor(factor: number) {
    await this.call("setZoomFactor", factor)
  }

  openLink(url: string) {
    this.bridge.postMessage(JSON.stringify({ method: "openLink", args: [url] }))
  }

  async openPath(path: string, app?: string) {
    await this.call("openPath", path, app)
  }

  showNotification(
    title: string,
    body?: string,
    level?: "info" | "success" | "warning" | "error",
    action?: string,
  ) {
    this.bridge.postMessage(JSON.stringify({ method: "showNotification", args: [title, body, level, action] }))
  }

  showProgressNotification(title: string, step: number, totalSteps: number, currentStep: string) {
    this.bridge.postMessage(
      JSON.stringify({ method: "showProgressNotification", args: [title, step, totalSteps, currentStep] }),
    )
  }

  relaunch() {
    this.bridge.postMessage(JSON.stringify({ method: "relaunch" }))
  }

  async storeGet(name: string, key: string) {
    return this.call("storeGet", name, key) as Promise<string | null>
  }

  async storeSet(name: string, key: string, value: string) {
    await this.call("storeSet", name, key, value)
  }

  async storeDelete(name: string, key: string) {
    await this.call("storeDelete", name, key)
  }

  async storeClear(name: string) {
    await this.call("storeClear", name)
  }

  async storeKeys(name: string) {
    return this.call("storeKeys", name) as Promise<string[]>
  }

  async storeLength(name: string) {
    return this.call("storeLength", name) as Promise<number>
  }

  onSqliteMigrationProgress(cb: (progress: SqliteMigrationProgress) => void) {
    this.sqliteListeners.add(cb)
    return () => {
      this.sqliteListeners.delete(cb)
    }
  }

  onMenuCommand(cb: (id: string) => void) {
    this.menuListeners.add(cb)
    return () => {
      this.menuListeners.delete(cb)
    }
  }
}

/**
 * Web 开发模式的 fallback 适配器
 */
class WebFallbackAdapter implements NativeIPCProtocol {
  async killSidecar() {
    /* no-op */
  }

  async awaitInitialization() {
    return { url: "http://localhost:9999", username: null, password: null }
  }

  async getDefaultServerUrl() {
    return null
  }

  async setDefaultServerUrl() {
    /* no-op */
  }

  async openFilePicker() {
    return prompt("Enter file path:") || null
  }

  async openDirectoryPicker() {
    return prompt("Enter directory path:") || null
  }

  async saveFilePicker() {
    return prompt("Enter save path:") || null
  }

  async readClipboardImage() {
    return null
  }

  async getWindowFocused() {
    return document.hasFocus()
  }

  async setWindowFocus() {
    window.focus()
  }

  async showWindow() {
    /* no-op */
  }

  async getZoomFactor() {
    return 1
  }

  async setZoomFactor() {
    /* no-op */
  }

  openLink(url: string) {
    window.open(url, "_blank")
  }

  async openPath() {
    /* no-op */
  }

  showNotification(title: string, body?: string) {
    if ("Notification" in window) new Notification(title, { body })
  }

  showProgressNotification(title: string, step: number, totalSteps: number, currentStep: string) {
    if ("Notification" in window) new Notification(title, { body: `${step}/${totalSteps}: ${currentStep}` })
  }

  relaunch() {
    window.location.reload()
  }

  async storeGet(name: string, key: string) {
    return localStorage.getItem(`${name}:${key}`)
  }

  async storeSet(name: string, key: string, value: string) {
    localStorage.setItem(`${name}:${key}`, value)
  }

  async storeDelete(name: string, key: string) {
    localStorage.removeItem(`${name}:${key}`)
  }

  async storeClear(name: string) {
    const prefix = `${name}:`
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(prefix)) localStorage.removeItem(k)
    }
  }

  async storeKeys(name: string) {
    const prefix = `${name}:`
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
  }

  async storeLength(name: string) {
    return (await this.storeKeys(name)).length
  }

  onSqliteMigrationProgress() {
    return () => {}
  }

  onMenuCommand() {
    return () => {}
  }
}
