// Service worker: routes side panel requests, tracks tabs, and owns each session's browser.
import {
  BROWSING_PERMISSIONS,
  PANEL_PORT,
  WELCOME_PORT,
  type AccessRequest,
  type ActiveTab,
  type FromWelcome,
  type ToBackground,
  type ToPanel,
  type TabRequest,
  type ToWelcome,
} from "../shared/protocol"
import type { RelayCommand } from "../shared/relay-rpc"
import { appliesTo, hostLabel, type SiteScript, type SiteScriptApproval, type SiteScriptDraft } from "../shared/site-script"
import { createBrowserControl } from "./browser-control"
import { grant, granted, readBrowsing } from "./browsing"
import { shareable } from "./policy"
import { createRelayLink } from "./relay-link"
import { createService } from "./service"
import { createSessionBrowser, type SessionBrowser } from "./session-browser"
import { createSiteScripts, type Applied } from "./site-scripts"

type Panel = { port: chrome.runtime.Port; windowID?: number; sessionID?: string }

const panels = new Set<Panel>()
/** Welcome tabs: they see setup status but are not panels, so they never answer approvals. */
const watchers = new Set<chrome.runtime.Port>()
const browsers = new Map<string, Promise<SessionBrowser>>()
const service = createService((state) => broadcastStatus({ type: "service", state }))
const scripts = createSiteScripts((state) => {
  broadcastStatus({ type: "scripts", state })
  void updateBadges()
})
const approvals = new Map<string, { approval: SiteScriptApproval; answer: (approve: boolean) => void }>()
const accessRequests = new Map<string, { request: AccessRequest; answer: (allow: boolean) => void }>()
const tabRequests = new Map<string, { request: TabRequest; answer: (allow: boolean) => void }>()
const link = createRelayLink({ service, run: runRelayCommand })
const control = createBrowserControl({
  changed: (state) => broadcastStatus({ type: "browserControl", state }),
  badgesChanged: () => void updateBadges(),
})
let keepalive: ReturnType<typeof setInterval> | undefined

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === WELCOME_PORT && port.sender?.id === chrome.runtime.id) return watch(port)
  if (port.name !== PANEL_PORT || port.sender?.id !== chrome.runtime.id) return
  const panel: Panel = { port }
  panels.add(panel)
  port.onMessage.addListener((message: ToBackground) => {
    void receive(panel, message).catch((error: unknown) => {
      console.warn("[opencode-browser]", message.type, error)
      post(panel, { type: "error", message: error instanceof Error ? error.message : String(error) })
    })
  })
  port.onDisconnect.addListener(() => {
    panels.delete(panel)
    // Site script requests are relayed while a panel is open, since only a panel can approve them.
    if (panels.size === 0) link.stop()
    void release(panel.sessionID)
  })
})

function watch(port: chrome.runtime.Port) {
  watchers.add(port)
  port.onDisconnect.addListener(() => watchers.delete(port))
  port.onMessage.addListener((message: FromWelcome) => {
    if (message.type === "service.refresh") void service.refresh().catch(() => undefined)
    if (message.type === "scripts.refresh") void scripts.reconcile()
    if (message.type === "browserControl.reconnect") control.reconnect()
  })
  postWatcher(port, { type: "service", state: service.state() })
  postWatcher(port, { type: "scripts", state: scripts.state() })
  postWatcher(port, { type: "browserControl", state: control.state() })
  void service.get().catch(() => undefined)
}

async function receive(panel: Panel, message: ToBackground) {
  switch (message.type) {
    case "panel.hello": {
      panel.windowID = message.windowID
      post(panel, { type: "service", state: service.state() })
      post(panel, { type: "scripts", state: scripts.state() })
      post(panel, { type: "approvals", approvals: pendingApprovals() })
      post(panel, { type: "access", requests: pendingAccess() })
      post(panel, { type: "tabRequests", requests: pendingTabRequests() })
      post(panel, { type: "browserControl", state: control.state() })
      link.start()
      await service.get().catch(() => undefined)
      await sendActiveTab(message.windowID)
      return
    }
    case "service.refresh":
      await service.refresh().catch(() => undefined)
      return
    case "service.manual":
      await service.manual(message.url, message.password).catch(() => undefined)
      return
    case "service.clearManual":
      await service.clearManual().catch(() => undefined)
      return
    case "session.show": {
      const previous = panel.sessionID
      panel.sessionID = message.sessionID
      const browser = await ensure(message.sessionID, {
        directory: message.directory,
        ...(message.workspaceID ? { workspaceID: message.workspaceID } : {}),
      }, panel.windowID)
      browser.want(panel.windowID ?? chrome.windows.WINDOW_ID_CURRENT)
      post(panel, { type: "browser", state: browser.snapshot() })
      if (panel.windowID !== undefined) await sendActiveTab(panel.windowID)
      if (previous !== message.sessionID) await release(previous)
      return
    }
    case "session.hide": {
      const previous = panel.sessionID
      panel.sessionID = undefined
      await release(previous)
      return
    }
    case "browser.takeover":
      ;(await browsers.get(message.sessionID))?.takeover(panel.windowID ?? chrome.windows.WINDOW_ID_CURRENT)
      return
    case "tab.share":
      await shareTab(message.sessionID, message.chromeTabID)
      return
    case "tab.unshare":
      ;(await browsers.get(message.sessionID))?.unshare(message.tabID)
      if (panel.windowID !== undefined) await sendActiveTab(panel.windowID)
      return
    case "tab.focus":
      await (await browsers.get(message.sessionID))?.focus(message.tabID)
      return
    case "scripts.install": {
      const result = await scripts.install(message.draft)
      post(panel, { type: "notice", message: `Installed "${result.script.name}". ${appliedText(result.script, result.applied)}` })
      return
    }
    case "scripts.setEnabled": {
      const result = await scripts.setEnabled(message.id, message.enabled)
      if (result.applied.injected || result.applied.reloaded)
        post(panel, { type: "notice", message: `${message.enabled ? "Turned on" : "Turned off"} "${result.script.name}". ${appliedText(result.script, result.applied)}` })
      return
    }
    case "scripts.remove": {
      const result = await scripts.remove(message.id)
      if (result.applied.reloaded)
        post(panel, { type: "notice", message: `Deleted "${result.script.name}". ${appliedText(result.script, result.applied)}` })
      return
    }
    case "scripts.refresh":
      await scripts.reconcile()
      return
    case "browserControl.attach":
      control.attachTab(message.chromeTabID)
      return
    case "browserControl.continue":
      control.completeHandoff(message.chromeTabID)
      return
    case "browserControl.reconnect":
      control.reconnect()
      return
    case "tabRequest.reply": {
      const pending = tabRequests.get(message.id)
      if (!pending) return
      tabRequests.delete(message.id)
      broadcastTabRequests()
      pending.answer(message.allow)
      return
    }
    case "access.reply": {
      const pending = accessRequests.get(message.id)
      if (!pending) return
      accessRequests.delete(message.id)
      broadcastAccess()
      pending.answer(message.allow)
      return
    }
    case "approval.reply": {
      const pending = approvals.get(message.id)
      if (!pending) return
      approvals.delete(message.id)
      broadcastApprovals()
      pending.answer(message.approve)
      return
    }
  }
}

/** Runs a site_scripts tool call relayed from the opencode plugin. */
async function runRelayCommand(command: RelayCommand, signal: AbortSignal): Promise<unknown> {
  switch (command.action) {
    case "list": {
      const state = scripts.state()
      return {
        allowed: state.available,
        ...(state.error ? { note: state.error } : {}),
        scripts: (await scripts.list()).map(summary),
      }
    }
    case "get":
      return scripts.get(command.id)
    case "install": {
      if (!(await approve(command.draft, signal))) throw new Error("The user chose Deny in the side panel; the site script was not installed.")
      const result = await scripts.install(command.draft)
      return {
        ...summary(result.script),
        note: `Installed. ${appliedText(result.script, result.applied)} Verify it on the page; do not reload tabs that were already updated.`,
      }
    }
    case "remove": {
      const result = await scripts.remove(command.id)
      return { ...summary(result.script), note: appliedText(result.script, result.applied) }
    }
    case "set_enabled": {
      const result = await scripts.setEnabled(command.id, command.enabled)
      return { ...summary(result.script), note: appliedText(result.script, result.applied) }
    }
    case "history":
    case "bookmarks":
    case "top_sites":
    case "recently_closed":
      if (!(await allowBrowsing(command.sessionID, command.action, signal)))
        throw new Error("The user chose Don't allow in the side panel; browsing data was not shared with this conversation.")
      return readBrowsing(command)
    case "request_tab":
      return requestTab(command, signal)
  }
}

/** Shares a user's tab with one session; a tab belongs to one session at a time. Returns its tabID. */
async function shareTab(sessionID: string, chromeTabID: number) {
  const browser = await browsers.get(sessionID)
  if (!browser) return undefined
  await Promise.all(
    Array.from(browsers.values(), async (other) => {
      const resolved = await other
      if (resolved !== browser) resolved.release(chromeTabID)
    }),
  )
  const tabID = await browser.share(chromeTabID)
  const windows = new Set(Array.from(panels, (panel) => panel.windowID).filter((id) => id !== undefined))
  await Promise.all(Array.from(windows, (id) => sendActiveTab(id)))
  return tabID
}

/**
 * browser.tabs.request: finds the tab the agent asked for (the user's current tab, or an open tab matching
 * its query), asks the user in the panel, and shares it with the session.
 */
async function requestTab(command: Extract<RelayCommand, { action: "request_tab" }>, signal: AbortSignal) {
  const browser = await browsers.get(command.sessionID)
  const showing = Array.from(panels).filter((panel) => panel.sessionID === command.sessionID)
  if (!browser || !showing.length)
    throw new Error("No OpenCode Browser side panel is showing this conversation. Ask the user to open it here, then retry.")
  const query = command.query?.trim()
  const tab = query ? await matchTab(query) : await currentTab(showing.map((panel) => panel.windowID))
  if (!tab?.id)
    throw new Error(
      query
        ? `No open tab matches "${query}". Ask the user which tab they mean, or open the page yourself with browser.tabs.open.`
        : "Could not find the tab the user is looking at.",
    )
  const summary = { title: tab.title || hostLabel(tab.url ?? ""), url: tab.url ?? "" }
  const existing = browser.tabIDFor(tab.id)
  if (existing) return { tabID: existing, ...summary, note: "This tab was already available to this conversation." }
  if (!shareable(tab.url))
    throw new Error(
      `The ${query ? "matching" : "user's current"} tab (${summary.url || "a browser page"}) is a browser or extension page, which cannot be shared. Ask the user to switch to a regular web page.`,
    )
  const request: TabRequest = {
    id: crypto.randomUUID(),
    sessionID: command.sessionID,
    tab: { ...summary, ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}) },
    current: !query,
    ...(command.reason?.trim() ? { reason: command.reason.trim().slice(0, 200) } : {}),
  }
  const allowed = await new Promise<boolean>((resolve) => {
    const withdraw = () => {
      if (!tabRequests.delete(request.id)) return
      broadcastTabRequests()
      resolve(false)
    }
    tabRequests.set(request.id, {
      request,
      answer: (allow) => {
        signal.removeEventListener("abort", withdraw)
        resolve(allow)
      },
    })
    signal.addEventListener("abort", withdraw, { once: true })
    broadcastTabRequests()
  })
  if (!allowed) throw new Error("The user chose Don't share in the side panel; the tab was not shared with this conversation.")
  const tabID = await shareTab(command.sessionID, tab.id)
  if (!tabID) throw new Error("The conversation's browser closed before the tab could be shared. Retry.")
  return { tabID, ...summary }
}

/** The active tab in a window showing the conversation, else the last focused window's. */
async function currentTab(windowIDs: (number | undefined)[]) {
  for (const windowId of windowIDs) {
    if (windowId === undefined) continue
    const [tab] = await chrome.tabs.query({ active: true, windowId }).catch(() => [])
    if (tab) return tab
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab
}

/** The most recently used regular tab whose title or URL contains every word of the query. */
async function matchTab(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const tabs = (await chrome.tabs.query({})).filter((tab) => {
    const text = `${tab.title ?? ""} ${tab.url ?? ""}`.toLowerCase()
    return shareable(tab.url) && words.every((word) => text.includes(word))
  })
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]
}

/** Asks once per session whether the agent may read browsing data; the grant is remembered. */
async function allowBrowsing(sessionID: string, reason: AccessRequest["reason"], signal: AbortSignal) {
  // The browser permissions are optional and requested on the panel's Allow click; if the user removed
  // them in the browser's settings, ask again.
  const permitted = await chrome.permissions.contains({ permissions: BROWSING_PERMISSIONS })
  if (permitted && (await granted(sessionID))) return true
  if (panels.size === 0)
    throw new Error("The OpenCode Browser side panel is closed. Ask the user to open it so they can allow access.")
  // Parallel calls from one session share a single prompt.
  const existing = Array.from(accessRequests.values()).find((pending) => pending.request.sessionID === sessionID)
  const answer = existing
    ? new Promise<boolean>((resolve) => {
        const previous = existing.answer
        existing.answer = (allow) => {
          previous(allow)
          resolve(allow)
        }
      })
    : new Promise<boolean>((resolve) => {
        const request: AccessRequest = { id: crypto.randomUUID(), sessionID, reason }
        const withdraw = () => {
          if (!accessRequests.delete(request.id)) return
          broadcastAccess()
          resolve(false)
        }
        accessRequests.set(request.id, {
          request,
          answer: (allow) => {
            signal.removeEventListener("abort", withdraw)
            resolve(allow)
          },
        })
        signal.addEventListener("abort", withdraw, { once: true })
        broadcastAccess()
      })
  const allowed = (await answer) && (await chrome.permissions.contains({ permissions: BROWSING_PERMISSIONS }))
  if (allowed) await grant(sessionID)
  return allowed
}

function pendingAccess() {
  return Array.from(accessRequests.values(), (pending) => pending.request)
}

function pendingTabRequests() {
  return Array.from(tabRequests.values(), (pending) => pending.request)
}

function broadcastTabRequests() {
  broadcast(() => true, { type: "tabRequests", requests: pendingTabRequests() })
}

function broadcastAccess() {
  broadcast(() => true, { type: "access", requests: pendingAccess() })
}

/**
 * The toolbar badge shows Browser Control's state for a tab it uses (ON, RUN, WAIT), otherwise how many
 * enabled site scripts run on the tab's page.
 */
async function updateBadges(tabs?: chrome.tabs.Tab[]) {
  const enabled = (await scripts.list()).filter((script) => script.enabled)
  const targets = tabs ?? (await chrome.tabs.query({}))
  await Promise.all(
    targets.map(async (tab) => {
      if (tab.id === undefined) return
      const relay = control.badge(tab.id)
      const count = tab.url ? enabled.filter((script) => appliesTo(script, tab.url!)).length : 0
      const text = relay?.text ?? (count ? String(count) : "")
      await chrome.action.setBadgeText({ tabId: tab.id, text }).catch(() => undefined)
      await chrome.action
        .setBadgeBackgroundColor({ tabId: tab.id, color: BADGE_COLORS[relay?.text ?? ""] ?? BADGE_COLORS.default })
        .catch(() => undefined)
      await chrome.action
        .setTitle({
          tabId: tab.id,
          title: relay?.title ?? (count ? `OpenCode Browser · ${count} site script${count === 1 ? "" : "s"} on this page` : "OpenCode Browser"),
        })
        .catch(() => undefined)
    }),
  )
}

// Neutral by default; amber while an agent runs, blue while it waits for the user.
const BADGE_COLORS: Record<string, string> = { default: "#3b3b3b", RUN: "#b45309", WAIT: "#2563eb" }

/** Asks every open panel; the first answer wins. A cancelled tool call withdraws the request. */
async function approve(draft: SiteScriptDraft, signal: AbortSignal) {
  if (panels.size === 0)
    throw new Error("The OpenCode Browser side panel is closed. Ask the user to open it so they can approve the script.")
  const approval = await scripts.preview(draft, crypto.randomUUID())
  return new Promise<boolean>((resolve) => {
    const withdraw = () => {
      if (!approvals.delete(approval.id)) return
      broadcastApprovals()
      resolve(false)
    }
    approvals.set(approval.id, {
      approval,
      answer: (approved) => {
        signal.removeEventListener("abort", withdraw)
        resolve(approved)
      },
    })
    signal.addEventListener("abort", withdraw, { once: true })
    broadcastApprovals()
  })
}

function pendingApprovals() {
  return Array.from(approvals.values(), (pending) => pending.approval)
}

function broadcastApprovals() {
  broadcast(() => true, { type: "approvals", approvals: pendingApprovals() })
}

function summary(script: SiteScript) {
  return {
    id: script.id,
    name: script.name,
    ...(script.description ? { description: script.description } : {}),
    matches: script.matches,
    ...(script.excludeMatches?.length ? { excludeMatches: script.excludeMatches } : {}),
    runAt: script.runAt,
    ...(script.world === "page" ? { world: script.world } : {}),
    enabled: script.enabled,
  }
}

function sites(script: SiteScript) {
  return [...new Set(script.matches.map(hostLabel))].join(", ")
}

/** Says what happened to open tabs, for toasts and the agent. */
function appliedText(script: SiteScript, applied: Applied) {
  const count = (n: number) => `${n} open tab${n === 1 ? "" : "s"}`
  const parts = [
    ...(applied.injected ? [`Running now in ${count(applied.injected)}.`] : []),
    ...(applied.reloaded ? [`Reloaded ${count(applied.reloaded)}.`] : []),
  ]
  return parts.length ? parts.join(" ") : `It applies the next time you open ${sites(script)}.`
}

function ensure(sessionID: string, location: { directory: string; workspaceID?: string }, windowID?: number) {
  const existing = browsers.get(sessionID)
  if (existing) return existing
  const created = createSessionBrowser({
    sessionID,
    location,
    windowId: windowID ?? chrome.windows.WINDOW_ID_CURRENT,
    service,
    preview: (path) => {
      const showing = Array.from(panels).filter((panel) => panel.sessionID === sessionID)
      if (!showing.length)
        throw new Error("No side panel is showing this conversation, so the file cannot be shown. Tell the user the path instead.")
      showing.forEach((panel) => post(panel, { type: "preview", sessionID, path }))
    },
    changed: (state) => {
      broadcast((panel) => panel.sessionID === sessionID, { type: "browser", state })
      const windows = new Set(Array.from(panels, (panel) => panel.windowID).filter((id) => id !== undefined))
      windows.forEach((id) => void sendActiveTab(id))
    },
  })
  browsers.set(sessionID, created)
  updateKeepalive()
  return created
}

/** A session's browser stays while a panel shows it or the agent still has tabs; then it detaches. */
async function release(sessionID: string | undefined) {
  if (!sessionID) return
  if (Array.from(panels).some((panel) => panel.sessionID === sessionID)) return
  const browser = await browsers.get(sessionID)
  if (!browser || !browser.empty) return
  browsers.delete(sessionID)
  updateKeepalive()
  await browser.dispose()
}

// Chrome stops an idle worker after 30 seconds even while a fetch stream is open. Extension API calls
// reset that timer, so ping one while any session's browser is attached.
function updateKeepalive() {
  if (browsers.size > 0 && !keepalive) keepalive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000)
  if (browsers.size === 0 && keepalive) {
    clearInterval(keepalive)
    keepalive = undefined
  }
}

async function forEachBrowser(callback: (browser: SessionBrowser) => void) {
  await Promise.all(Array.from(browsers.values(), async (browser) => callback(await browser)))
}

async function sendActiveTab(windowID: number) {
  const [tab] = await chrome.tabs.query({ active: true, windowId: windowID })
  const owners = await Promise.all(Array.from(browsers.values()))
  const active: ActiveTab | null = tab?.id
    ? {
        chromeTabID: tab.id,
        title: tab.title || tab.url || "Untitled",
        url: tab.url ?? "",
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        shareable: shareable(tab.url),
        ...(() => {
          const owner = owners.find((browser) => browser.owns(tab.id!))
          return owner ? { sessionID: owner.sessionID } : {}
        })(),
      }
    : null
  broadcast((panel) => panel.windowID === windowID, { type: "activeTab", tab: active })
}

function post(panel: Panel, message: ToPanel) {
  try {
    panel.port.postMessage(message)
  } catch {
    panels.delete(panel)
  }
}

function postWatcher(port: chrome.runtime.Port, message: ToWelcome) {
  try {
    port.postMessage(message)
  } catch {
    watchers.delete(port)
  }
}

/** Setup status goes to every panel and welcome tab. */
function broadcastStatus(message: ToWelcome) {
  broadcast(() => true, message)
  watchers.forEach((port) => postWatcher(port, message))
}

function broadcast(filter: (panel: Panel) => boolean, message: ToPanel) {
  panels.forEach((panel) => {
    if (filter(panel)) post(panel, message)
  })
}

void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.default })
void chrome.action.setBadgeTextColor?.({ color: "#ffffff" })

// Content scripts (page status, handoffs) and the recording document talk to Browser Control.
chrome.runtime.onMessage.addListener((message, sender) => {
  control.runtimeMessage(message, sender)
  return false
})

// Browser Control's toolbar action lets its sessions use the current tab; here the toolbar opens the panel,
// so that action lives in the icon's menu (and in the panel).
chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create(
    { id: "browser-control.attach", title: "Let Browser Control use this tab", contexts: ["action"] },
    () => void chrome.runtime.lastError,
  )
  if (details.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") })
})
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "browser-control.attach" && tab?.id !== undefined) control.attachTab(tab.id)
})

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  void forEachBrowser((browser) => browser.tabUpdated(tab))
  if (change.url || change.status === "loading") void updateBadges([tab])
  if (tab.active && (change.url || change.title || change.favIconUrl || change.status)) void sendActiveTab(tab.windowId)
})
chrome.tabs.onActivated.addListener((info) => {
  void sendActiveTab(info.windowId)
  // The previously active tab changed too; refresh every owned tab's active flag.
  void chrome.tabs.query({ windowId: info.windowId }).then((tabs) =>
    forEachBrowser((browser) => tabs.forEach((tab) => browser.tabUpdated(tab))),
  )
})
chrome.tabs.onRemoved.addListener((tabId) => {
  void forEachBrowser((browser) => browser.tabRemoved(tabId))
})
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || details.documentLifecycle === "prerender") return
  void forEachBrowser((browser) => browser.committed(details.tabId))
})
chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    for (const browser of await Promise.all(Array.from(browsers.values()))) if (browser.download(item)) return
  })()
})
chrome.downloads.onChanged.addListener((delta) => {
  void chrome.downloads.search({ id: delta.id }).then(([item]) => {
    if (item) void forEachBrowser((browser) => browser.downloadChanged(item))
  })
})
chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return
  void forEachBrowser((browser) => browser.loadFailed(details.tabId, details.error))
})
