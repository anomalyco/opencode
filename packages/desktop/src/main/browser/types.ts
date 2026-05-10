import type { Rectangle, WebContentsView } from "electron"

export type BrowserBoundingBox = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserSnapshotElement = {
  selector: string
  tagName: string
  role?: string
  accessibleName?: string
  visibleText?: string
  attributes: Record<string, string>
  boundingBox: BrowserBoundingBox
}

export type BrowserSnapshot = {
  url: string
  title: string
  elements: BrowserSnapshotElement[]
}

export type BrowserAnnotationData = BrowserSnapshotElement & {
  xpath?: string
  nearbyDomSanitized: string
}

export type BrowserInspectResult = {
  annotation: BrowserAnnotationData
  context?: BrowserAnnotation["context"]
  pageUrl: string
  pageTitle: string
  preview?: BrowserAnnotation["preview"]
  userComment: string
  viewportScreenshot?: BrowserScreenshot
}

export type BrowserDownload = {
  name: string
  path: string
  size: number
  createdAt: number
  modifiedAt: number
}

export type BrowserAnnotation = {
  id: string
  pageUrl: string
  pageTitle: string
  userComment: string
  element: {
    tagName: string
    role?: string
    accessibleName?: string
    visibleText?: string
    attributes: Record<string, string>
    selector: string
    xpath?: string
    boundingBox: BrowserBoundingBox
  }
  preview: {
    screenshotCrop?: string
    viewportScreenshotId?: string
  }
  context: {
    nearbyDomSanitized?: string
    accessibilitySnapshotNearby?: unknown
  }
  createdAt: number
}

export type BrowserScreenshot = {
  id: string
  pageUrl: string
  pageTitle: string
  imageData: string
  viewport: { width: number; height: number; deviceScaleFactor: number }
  createdAt: number
}

export type BrowserAnnotationDetail = {
  id: string
  pageUrl: string
  pageTitle: string
  userComment: string
  element: BrowserAnnotation["element"]
  preview: BrowserAnnotation["preview"]
  context: BrowserAnnotation["context"]
  viewportScreenshot?: BrowserScreenshot
}

export type BrowserPanelState = {
  visible: boolean
  url: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  inspectMode: boolean
}

export type BrowserDialogAction = "accept" | "dismiss"

export type BrowserDialogResult = {
  success: boolean
  unsupported?: true
  message?: string
}

export type BrowserRunCodeResult = {
  result: unknown
  error?: string
  truncated?: true
}

export type BrowserId = string

export type BrowserConsoleLevel = "log" | "info" | "warn" | "error" | "debug"

export type BrowserConsoleEntry = {
  browserId: BrowserId
  level: BrowserConsoleLevel
  message: string
  source: string
  line: number | null
  timestamp: number
  truncated?: true
}

export type BrowserConsoleQuery = {
  browserId: BrowserId
  levels?: BrowserConsoleLevel[]
  limit?: number
}

export type BrowserConsoleReadResult = {
  browserId: BrowserId
  entries: BrowserConsoleEntry[]
  truncated?: true
}

export type BrowserInstance = {
  id: BrowserId
  view: WebContentsView
  title: string
  url: string
  bounds: Rectangle
  state: BrowserPanelState
  inspectMode: boolean
}

export type MultiBrowserState = {
  activeBrowserId?: BrowserId
  browsers: BrowserInstance[]
}

export type AgentToolPayload =
  | { tool: "browser.open" }
  | { tool: "browser.navigate"; url: string }
  | { tool: "browser.back" }
  | { tool: "browser.forward" }
  | { tool: "browser.reload" }
  | { tool: "browser.click"; selector: string }
  | { tool: "browser.hover"; selector: string; browserId?: BrowserId }
  | { tool: "browser.drag"; selector: string; targetSelector: string; browserId?: BrowserId }
  | { tool: "browser.handle_dialog"; action: BrowserDialogAction; promptText?: string; browserId?: BrowserId }
  | { tool: "browser.run_code"; code: string; browserId?: BrowserId }
  | { tool: "browser.run_playwright_code"; code: string; browserId?: BrowserId }
  | { tool: "browser.type"; selector: string; text: string }
  | { tool: "browser.press"; key: string }
  | { tool: "browser.screenshot" }
  | { tool: "browser.inspect"; selector?: string }
  | { tool: "browser.get_snapshot" }
  | { tool: "browser.annotation.get_detail"; id: string }
  | { tool: "browser.clear_data" }
  | { tool: "browser.upload_file"; selector: string; fileRef: string }
  | { tool: "browser.downloads.list" }
