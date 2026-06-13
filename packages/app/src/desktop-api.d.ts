export {}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
    }
    api?: {
      openBrowser?: (url?: string) => Promise<void>
      closeBrowser?: () => Promise<void>
      browserAutomation?: (action: string, params?: Record<string, unknown>) => Promise<unknown>
      parseMarkdownCommand?: (markdown: string) => Promise<string>
      setActiveWebview?: (id: number) => Promise<boolean>
      clearActiveWebview?: (id?: number) => Promise<boolean>
      onActivateBrowserTab?: (cb: (payload: { url?: string }) => void) => () => void
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      exportDebugLogs?: () => Promise<string>
    }
  }
}
