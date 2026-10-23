// Messages between the extension's status page (welcome.html) and the background service worker. The page holds
// one `chrome.runtime.connect({ name: STATUS_PORT })` port and watches the relay connection through it.

import type { PageStatus } from "../agent-relay/protocol"

/** The link to the OpenCode Browser relay, which runs agent sessions for the browse MCP server and CLI. */
export type AgentRelayStatus =
  /** No relay is running yet; the CLI or MCP server starts one on demand. */
  | "offline"
  | "connecting"
  | "connected"
  /** OpenCode Browser in another browser or profile holds the relay's connection. */
  | "conflict"
  /** The relay speaks another protocol version; updating both fixes it. */
  | "incompatible"

export type AgentRelayState = {
  status: AgentRelayStatus
  /** Tabs agents use, with their page status when an agent is working or waiting for the user. */
  tabs: { tabId: number; status?: PageStatus }[]
}

/** chrome.runtime.sendMessage request from an extension page; the worker answers with `{ text }`. */
export const AGENT_DIAGNOSTICS = "agents.diagnostics"

export const STATUS_PORT = "opencode-browser.status"

export type ToStatusPage = { type: "agents"; state: AgentRelayState }
export type FromStatusPage = { type: "agents.reconnect" } | { type: "tabs.cleanup" }
