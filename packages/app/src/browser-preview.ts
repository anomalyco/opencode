export type BrowserPreviewErrorKind = "unreachable" | "tls" | "blocked" | "crashed" | "unknown"

export type BrowserPreviewError = {
  kind: BrowserPreviewErrorKind
  message: string
}

export type BrowserPreviewTab = {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  autoRefresh: boolean
  deviceEmulation: boolean
  zoom: number
  consoleCapture: boolean
  error?: BrowserPreviewError
}

export type BrowserPreviewState = {
  visible: boolean
  tabs: BrowserPreviewTab[]
  activeTabId?: string
}

export type BrowserPreviewBounds = {
  x: number
  y: number
  width: number
  height: number
  revision: number
}

export type BrowserPreviewElement = {
  url: string
  selector: string
  tag: string
  text: string
  html: string
  rect: { x: number; y: number; width: number; height: number }
  textTruncated: boolean
  htmlTruncated: boolean
}

export type BrowserPreviewCommand =
  | { type: "new-tab"; url?: string }
  | { type: "close-tab"; tabId: string }
  | { type: "activate-tab"; tabId: string }
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "hard-reload" }
  | { type: "set-auto-refresh"; enabled: boolean }
  | { type: "open-external" }
  | { type: "open-devtools" }
  | { type: "set-device-emulation"; enabled: boolean }
  | { type: "set-zoom"; zoom: number }
  | { type: "clear-cache" }
  | { type: "start-console-capture" }
  | { type: "get-console-logs" }
  | { type: "read-dom" }
  | { type: "capture-screenshot" }
  | { type: "pick-element" }
  | { type: "cancel-element-picker" }

export type BrowserPreviewResult =
  | { type: "none" }
  | { type: "dom"; content: string; truncated: boolean }
  | { type: "screenshot"; dataUrl: string }
  | { type: "console"; entries: { level: number; message: string; source: string; line: number }[] }
  | { type: "element"; element: BrowserPreviewElement }

export type BrowserPreviewPlatform = {
  show(sessionID: string, url?: string): Promise<BrowserPreviewState>
  hide(): Promise<void>
  setBounds(bounds: BrowserPreviewBounds): Promise<void>
  command(command: BrowserPreviewCommand): Promise<BrowserPreviewResult>
  subscribe(callback: (state: BrowserPreviewState) => void): () => void
}
