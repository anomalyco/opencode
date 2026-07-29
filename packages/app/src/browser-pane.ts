import type { ServerProtocol } from "./utils/server-protocol"

export type BrowserPaneTarget = Readonly<{ sessionID: string }>

export type BrowserPaneEndpoint = Readonly<{ url: string; username?: string; password?: string }>

export type BrowserPaneBinding = BrowserPaneTarget &
  Readonly<{ bindingID: string; endpoint: BrowserPaneEndpoint }>

export type BrowserPaneBounds = { x: number; y: number; width: number; height: number }

export type BrowserPaneLayout = {
  visible: boolean
  bounds?: BrowserPaneBounds
}

export type BrowserPaneRegistration = {
  setLayout(layout?: BrowserPaneLayout): void
  close(): void
}

export type BrowserPanePlatform = {
  register(binding: BrowserPaneBinding, onOpen: () => void): BrowserPaneRegistration
}

export function browserPaneAvailable(input: {
  platform: boolean
  sessionID?: string
  protocol?: ServerProtocol
}) {
  return input.platform && !!input.sessionID && input.protocol === "v2"
}

export function createBrowserPaneBinding(input: BrowserPaneTarget & { endpoint: BrowserPaneEndpoint }) {
  return {
    sessionID: input.sessionID,
    bindingID: globalThis.crypto.randomUUID(),
    endpoint: input.endpoint,
  } satisfies BrowserPaneBinding
}
