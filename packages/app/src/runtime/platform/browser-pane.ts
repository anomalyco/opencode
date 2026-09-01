import type { Browser } from "@opencode-ai/browser/rpc"

export type BrowserPaneEndpoint = Readonly<{ url: string; username?: string; password?: string }>
export type BrowserPaneTarget = Readonly<{ sessionID: string; endpoint: BrowserPaneEndpoint }>
export type BrowserPaneLayout = { visible: boolean; bounds?: { x: number; y: number; width: number; height: number } }

export type BrowserPaneCommand = Browser.Action
export type BrowserPaneState = Browser.State | null
export type BrowserPaneEvent = { type: "open" } | { type: "state"; state: BrowserPaneState; error?: string }

export type BrowserPaneRegistration = {
  setLayout(layout?: BrowserPaneLayout): void
  command(command: BrowserPaneCommand): Promise<void>
  close(): void
}

export type BrowserPanePlatform = {
  register(target: BrowserPaneTarget, listener: (event: BrowserPaneEvent) => void): BrowserPaneRegistration
}
