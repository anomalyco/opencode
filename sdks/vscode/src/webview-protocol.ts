// Messages between the extension host and the sidebar webview. The webview bundle imports these types too, so this file
// stays free of runtime code and of the `vscode` module.

/** Written into the webview HTML as JSON; the webview reads it before it renders. */
export type Bootstrap = {
  /** Origin of the OpenCode server. Requests to it go through the extension host, which adds the credential. */
  server: string
  /** The window's first folder: the only project the app offers, where a new session starts. */
  directory: string
  version: string
  /**
   * Loopback origin serving the same files as the webview's resource root. VS Code only serves resources to the
   * webview document, so workers load their scripts from here instead.
   */
  assets: string
  configuration: Configuration
}

/**
 * The extension's VS Code settings, which stand in for the app's Settings screen, keyed by their name under `opencode.`.
 * `package.json` declares each one. `reduceMotion` is VS Code's own `workbench.reduceMotion`, which the app follows.
 */
export type Configuration = {
  followUpBehavior: "steer" | "queue"
  autoAcceptPermissions: boolean
  showAgent: boolean
  "timeline.detail": "everything" | "detailed" | "compact" | "quiet" | "text-only"
  "timeline.changedFiles": boolean
  "notifications.agent": boolean
  "notifications.permissions": boolean
  "notifications.questions": boolean
  "notifications.errors": boolean
  "sounds.agent": boolean
  "sounds.permissions": boolean
  "sounds.questions": boolean
  "sounds.errors": boolean
  "sounds.interface": boolean
  reduceMotion: "on" | "off" | "auto"
}

export const BOOTSTRAP_ELEMENT_ID = "opencode-vscode-bootstrap"

export type WebviewMessage =
  | {
      type: "fetch"
      id: number
      url: string
      method: string
      headers: [string, string][]
      body?: Uint8Array
    }
  | { type: "fetch.abort"; id: number }
  | { type: "open.external"; url: string }
  | { type: "open.file"; url: string }
  | { type: "open.path"; path: string }
  | { type: "notify"; title: string; description?: string }
  | { type: "clipboard.write"; text: string }
  | { type: "settings.open" }
  | { type: "reload" }

export type HostMessage =
  | { type: "fetch.head"; id: number; status: number; statusText: string; headers: [string, string][] }
  | { type: "fetch.chunk"; id: number; chunk: Uint8Array }
  | { type: "fetch.end"; id: number }
  | { type: "fetch.error"; id: number; message: string }
  | { type: "configuration"; configuration: Configuration }
