import type { BrowserPaneBinding, BrowserPaneLayout } from "@opencode-ai/app/browser-pane"
export const BrowserPaneIPC = {
  register: "browser-pane-register", unregister: "browser-pane-unregister", layout: "browser-pane-layout",
  open: "browser-pane-open",
} as const

export type BrowserPaneOpenEvent = { readonly bindingID: string }
export type BrowserPaneRegisterInput = BrowserPaneBinding
export type BrowserPaneLayoutInput = { readonly bindingID: string; readonly layout?: BrowserPaneLayout }
