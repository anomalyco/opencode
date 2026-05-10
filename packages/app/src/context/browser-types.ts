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

export type BrowserConsoleLevel = "log" | "info" | "warn" | "error" | "debug"

export type BrowserConsoleEntry = {
  browserId: string
  level: BrowserConsoleLevel
  message: string
  source: string
  line: number | null
  timestamp: number
  truncated?: true
}

export type BrowserConsoleMessagesParams = {
  browserId?: string
  levels?: BrowserConsoleLevel[]
  limit?: number
}

export type BrowserConsoleReadResult = {
  browserId: string
  entries: BrowserConsoleEntry[]
  truncated?: true
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
  setActiveBrowser?: (browserId: string) => Promise<{ success: boolean; state: unknown }>
  createBrowser?: (params?: BrowserCreateParams) => Promise<BrowserCreateResult>
  closeBrowser?: (browserId: string) => Promise<BrowserLifecycleResult>
  open: () => Promise<BrowserState>
  onOpenRequested: (cb: () => void) => () => void
  navigate: (url: string) => Promise<BrowserNavigationState>
  back: () => Promise<BrowserNavigationState>
  forward: () => Promise<BrowserNavigationState>
  reload: () => Promise<void>
  clearData: () => Promise<void>
  clearAnnotationMarkers?: () => Promise<void>
  getConsoleMessages?: (params?: BrowserConsoleMessagesParams) => Promise<BrowserConsoleReadResult>
  clearConsoleMessages?: (params?: BrowserConsoleClearParams) => Promise<BrowserConsoleClearResult>
  getState: () => Promise<BrowserState>
  screenshot: () => Promise<string | null>
  startInspectMode: () => Promise<BrowserInspectResult | null>
  stopInspectMode: () => Promise<void>
  getAnnotationData: (selector: string) => Promise<BrowserAnnotationData | null>
  toolClick: (selector: string) => Promise<void>
  toolType: (selector: string, text: string) => Promise<void>
  toolPress: (key: string) => Promise<void>
  toolGetAnnotationDetail: (id: string) => Promise<BrowserAnnotationDetail | null>
  toolConsoleMessages?: (params?: BrowserConsoleMessagesParams) => Promise<BrowserConsoleReadResult>
  toolConsoleClear?: (params?: BrowserConsoleClearParams) => Promise<BrowserConsoleClearResult>
  storeAnnotationDetail: (id: string, detail: BrowserAnnotationDetail) => Promise<void>
  toolInspect: {
    (): Promise<BrowserSnapshot>
    (selector: string): Promise<BrowserAnnotationData | null>
  }
  toolGetSnapshot: () => Promise<BrowserSnapshot>
  toolUploadFile?: (selector: string, fileRef: string, workspaceRoot?: string) => Promise<void>
  toolListDownloads?: () => Promise<unknown[]>
}

export type TitlebarTheme = {
  mode: "light" | "dark"
}

export type ElectronAPI = {
  setTitlebar?: (theme: TitlebarTheme) => Promise<void>
  browser?: BrowserAPI
}
