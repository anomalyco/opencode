// Messages between the side panel and the background service worker. Each panel holds one long-lived
// `chrome.runtime.connect({ name: PANEL_PORT })` port; the open port also keeps the worker alive.

import type { PageStatus } from "../browser-control/protocol"
import type { SiteScriptApproval, SiteScriptDraft, SiteScriptsState } from "./site-script"

export type RelayStatus =
  /** No relay is running; Browser Control's CLI or MCP server starts one on demand. */
  | "offline"
  | "connecting"
  | "connected"
  /** The relay runs but refused this extension (an older relay that does not know OpenCode Browser). */
  | "rejected"
  /** Another extension (usually the old Browser Control extension) holds this profile's connection. */
  | "conflict"
  | "incompatible"

export type RelayState = {
  status: RelayStatus
  /** Tabs the relay has attached, with their page status when a session is running or waiting. */
  tabs: { tabId: number; status?: PageStatus }[]
}

export const PANEL_PORT = "opencode-browser.panel"
/** The welcome tab's port: it only watches setup status and asks for re-checks; it is not a panel. */
export const WELCOME_PORT = "opencode-browser.welcome"

export type ServiceInfo = { url: string; password: string; source: "host" | "manual" }

export type ServiceState =
  | { status: "loading" }
  | { status: "ready"; info: ServiceInfo }
  | { status: "error"; message: string; hostMissing: boolean }

/**
 * - idle: no attachment requested for this session.
 * - connecting: attaching or reconnecting after a dropped connection.
 * - connected: the agent can use this session's tabs.
 * - replaced: another client (usually the desktop app) took the session's browser.
 * - unsupported: the server has no compatible browser plugin.
 */
export type BrowserStatus = "idle" | "connecting" | "connected" | "replaced" | "unsupported"

export type PanelTab = {
  /** The tab ID the agent sees, `tab_<uuid>`. */
  id: string
  chromeTabID: number
  title: string
  url: string
  favIconUrl?: string
  /** opened: the agent opened it. shared: the user shared an existing tab. */
  kind: "opened" | "shared"
  active: boolean
  loading: boolean
}

export type BrowserState = {
  sessionID: string
  status: BrowserStatus
  error?: string
  tabs: PanelTab[]
}

export type ActiveTab = {
  chromeTabID: number
  title: string
  url: string
  favIconUrl?: string
  /** http(s) pages only; browser pages and the web store cannot be debugged. */
  shareable: boolean
  /** The session that already has this tab, if any. */
  sessionID?: string
}

/** Optional manifest permissions, requested from the side panel the first time the user allows access. */
export const BROWSING_PERMISSIONS: chrome.runtime.ManifestPermission[] = ["history", "bookmarks", "topSites", "sessions"]

/** One grant covers history, bookmarks, top sites, and recently closed tabs for a session. */
export type AccessRequest = {
  id: string
  sessionID: string
  /** What the agent asked for first, for example "history". */
  reason: "history" | "bookmarks" | "top_sites" | "recently_closed"
}

/** A conversation asking the user to share one of their open tabs (browser.tabs.request). */
export type TabRequest = {
  id: string
  sessionID: string
  tab: { title: string; url: string; favIconUrl?: string }
  /** Whether it is the tab the user is looking at, rather than one matched by the agent's query. */
  current: boolean
  reason?: string
}

export type ToBackground =
  | { type: "panel.hello"; windowID: number }
  | { type: "service.refresh" }
  | { type: "service.manual"; url: string; password: string }
  | { type: "service.clearManual" }
  /** Show this session in the panel: attach its browser unless the user turned it off. */
  | { type: "session.show"; sessionID: string; directory: string; workspaceID?: string }
  | { type: "session.hide" }
  /** Take the session's browser back after another client replaced it. */
  | { type: "browser.takeover"; sessionID: string }
  | { type: "tab.share"; sessionID: string; chromeTabID: number }
  | { type: "tab.unshare"; sessionID: string; tabID: string }
  | { type: "tab.focus"; sessionID: string; tabID: string }
  /** The user installed a script from the panel (for example a userscript in a reply); no approval needed. */
  | { type: "scripts.install"; draft: SiteScriptDraft }
  | { type: "scripts.setEnabled"; id: string; enabled: boolean }
  | { type: "scripts.remove"; id: string }
  /** Re-check whether site scripts are allowed, after the user changes the browser setting. */
  | { type: "scripts.refresh" }
  /** The user's answer to an agent's install request. */
  | { type: "approval.reply"; id: string; approve: boolean }
  /** The user's answer to a request to read browsing history and bookmarks. */
  | { type: "access.reply"; id: string; allow: boolean }
  /** The user's answer to a request to share a tab. */
  | { type: "tabRequest.reply"; id: string; allow: boolean }
  /** Let Browser Control (its CLI and MCP agents) use this tab. */
  | { type: "browserControl.attach"; chromeTabID: number }
  /** Answer Browser Control's handoff on this tab, the same as the page's Continue button. */
  | { type: "browserControl.continue"; chromeTabID: number }
  | { type: "browserControl.reconnect" }

export type ToPanel =
  | { type: "service"; state: ServiceState }
  | { type: "browser"; state: BrowserState }
  | { type: "activeTab"; tab: ActiveTab | null }
  /** A panel request failed, for example sharing a tab the browser will not let extensions debug. */
  | { type: "error"; message: string }
  | { type: "scripts"; state: SiteScriptsState }
  /** Agent install requests waiting for the user, oldest first. Any open panel may answer. */
  | { type: "approvals"; approvals: SiteScriptApproval[] }
  /** A panel-initiated script change succeeded; for confirmation toasts. */
  | { type: "notice"; message: string }
  /** Sessions asking to read browsing history, bookmarks, top sites, and recently closed tabs. */
  | { type: "access"; requests: AccessRequest[] }
  | { type: "tabRequests"; requests: TabRequest[] }
  /** The agent asked to show a server file (browser.preview) in the panel showing this session. */
  | { type: "preview"; sessionID: string; path: string }
  /** The Browser Control relay connection and the tabs its sessions use. */
  | { type: "browserControl"; state: RelayState }

export type ToWelcome = Extract<ToPanel, { type: "service" | "scripts" | "browserControl" }>
export type FromWelcome = Extract<ToBackground, { type: "service.refresh" | "scripts.refresh" | "browserControl.reconnect" }>
