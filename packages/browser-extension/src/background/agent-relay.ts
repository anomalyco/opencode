// The link to the OpenCode Browser relay (ws://127.0.0.1:19988/extension). The relay runs agent sessions
// for the browse MCP server and the opencode-browser CLI (Playwright `execute`, recordings, handoffs) and drives tabs
// through this extension; this module runs its commands. The wire protocol is in ../agent-relay/protocol.ts,
// the relay itself in cli/src/relay.ts.
import {
  defaultRelayPort,
  encodeRecordingFrame,
  extensionProtocolVersion,
  extensionReconnectAlarmPeriodMs,
  isJsonObject,
  pageStatusFromJson,
  parseExtensionCommand,
  type ExtensionCommand,
  type JsonObject,
  type PageStatus,
} from "../agent-relay/protocol"
import type {
  OffscreenCancelRecordingResult,
  OffscreenOutgoingMessage,
  OffscreenStartRecordingResult,
  OffscreenStatusRecordingResult,
  OffscreenStopRecordingResult,
} from "../agent-relay/recording-types"
import type { AgentRelayState, AgentRelayStatus } from "../shared/protocol"
import { createAgentRelayLog, formatAgentRelayLog } from "./agent-relay-log"
import { AgentGroups } from "./agent-groups"
import { DebuggerHub } from "./debugger-hub"
import { TabCleanup } from "./tab-cleanup"

/** Badge text the relay asked for, by tab. */
export type AgentBadge = { text: string; title?: string }

const OWNER = "relay"
/** Overrides the relay port, for development and isolated tests. */
const PORT_KEY = "agentRelayPort"
const PROFILE_KEY = "agentRelayProfile"
const ALARM = "opencode-browser-relay"
// Relay tab groups end with this marker, which Chrome renders without width: they read like the session
// groups ("opencode", or the agent session's name) but stay distinguishable for cleanup.
const GROUP_MARKER = "\u2063"
const GROUP_COLOR = "grey"
const MAX_RECORDING_BUFFER = 16 * 1024 * 1024
/** The largest message the relay accepts, in bytes (256 MiB, as Playwright's CDP client); kept a little under. */
const MAX_MESSAGE = 255 * 1024 * 1024
const CONNECT_TIMEOUT = 10_000
const KEEPALIVE = 20_000
const BACKOFF_BASE = 500
const BACKOFF_CAP = 15_000
/** A connection that lasted this long was healthy; the next failure starts the backoff over. */
const STABLE_AFTER = 5_000
/** CDP commands are frequent; only slow or failed ones go to the log. */
const SLOW_CDP = 2_000
// Another extension's frame in the page (1Password, LastPass, Bitwarden) makes Chrome refuse commands or
// drop the debugger; evicting the frame and re-attaching recovers.
const FOREIGN_FRAME = /Cannot access a chrome-extension:\/\/ URL|Debugger is not attached to the tab/i
const CLOSE_CODES: Record<number, string> = {
  1000: "normal",
  1001: "going away",
  1006: "abnormal (no relay, or the connection dropped)",
  1011: "handshake failed",
  4001: "replaced by a newer connection",
  4002: "hello missing or liveness probe failed",
  4003: "protocol incompatible",
  4004: "another browser or profile is connected",
}

export function createAgentRelay(input: { changed: (state: AgentRelayState) => void; badgesChanged: () => void }) {
  const log = createAgentRelayLog()
  let socket: WebSocket | undefined
  let starting: Promise<void> | undefined
  let generation = 0
  let status: AgentRelayStatus = "offline"
  let port = defaultRelayPort
  let attempts = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let keepalive: ReturnType<typeof setInterval> | undefined
  let connectedAt: number | undefined
  let offscreen: Promise<void> | undefined
  const cdp = { count: 0, errors: 0 }
  const relayTabs = new Set<number>()
  let reloading = false
  /** Tabs with a recording in progress; cleanup leaves them open. */
  const recordingTabs = new Set<number>()
  /** Each agent session's tab group, so a session keeps one group while its display name changes. */
  const sessionGroups = new Map<string, number>()
  const pageStatuses = new Map<number, PageStatus>()
  const badges = new Map<number, AgentBadge>()
  /** Tabs the user let agents use while the relay was not connected; announced once it is. */
  const pendingAttach = new Set<number>()

  const snapshot = (): AgentRelayState => ({
    status,
    tabs: Array.from(relayTabs, (tabId) => {
      const page = pageStatuses.get(tabId)
      return page ? { tabId, status: page } : { tabId }
    }),
  })
  const notify = () => input.changed(snapshot())
  const setStatus = (next: AgentRelayStatus) => {
    if (status === next) return
    log.add("status", { from: status, to: next })
    status = next
    notify()
  }

  const open = () => (socket?.readyState === WebSocket.OPEN ? socket : undefined)
  const send = (message: JsonObject) => {
    const data = serialize(message)
    // The relay drops a connection that sends more than it accepts; a lost event is better than a reconnect loop.
    if (data === undefined) return log.add("event.dropped", { method: String(message.method) })
    open()?.send(data)
  }
  const forget = (tabId: number) => {
    const known = relayTabs.delete(tabId)
    pageStatuses.delete(tabId)
    if (known) notify()
  }

  const connect = (reason: string) => {
    starting ??= start(reason).finally(() => {
      starting = undefined
    })
    return starting
  }

  const start = async (reason: string) => {
    if (socket && socket.readyState <= WebSocket.OPEN) return
    clearTimeout(retry)
    retry = undefined
    port = Number((await chrome.storage.local.get(PORT_KEY))[PORT_KEY]) || defaultRelayPort
    if (socket && socket.readyState <= WebSocket.OPEN) return
    const url = `ws://127.0.0.1:${port}/extension`
    const mine = ++generation
    // While no relay runs, attempts repeat until one starts; log the first ones of a streak, not every poll.
    const quiet = status === "offline" && attempts > 1
    if (!quiet) log.add("connect", { port, attempt: attempts, reason, generation: mine })
    const current = new WebSocket(url)
    socket = current
    let openedAt: number | undefined
    // A relay that accepts the TCP connection but never answers would otherwise hold this attempt forever.
    const timeout = setTimeout(() => {
      if (current.readyState !== WebSocket.CONNECTING) return
      log.add("connect.timeout", { port, ms: CONNECT_TIMEOUT })
      current.close()
    }, CONNECT_TIMEOUT)
    current.onopen = () => {
      clearTimeout(timeout)
      openedAt = Date.now()
      log.add("open", { port, generation: mine })
      void hello(current).catch((error: unknown) => {
        log.add("hello.error", { error: text(error) })
        current.close(1011, "Handshake failed")
      })
    }
    current.onmessage = (event) => {
      if (typeof event.data === "string") void handle(current, event.data)
    }
    current.onclose = (event) => {
      clearTimeout(timeout)
      current.onopen = current.onmessage = current.onclose = null
      if (socket !== current) return
      socket = undefined
      connectedAt = undefined
      clearInterval(keepalive)
      keepalive = undefined
      const lasted = openedAt === undefined ? undefined : Date.now() - openedAt
      if (lasted !== undefined && lasted >= STABLE_AFTER) attempts = 0
      if (!quiet || openedAt !== undefined) log.add("close", {
        code: event.code,
        meaning: CLOSE_CODES[event.code],
        reason: event.reason || undefined,
        clean: event.wasClean,
        opened: openedAt !== undefined,
        ms: lasted,
      })
      void chrome.runtime.sendMessage({ action: "recording.cancelAll" }).catch(() => undefined)
      if (event.code === 4003) setStatus("incompatible")
      else if (event.code === 4004) setStatus("conflict")
      // A missing relay is normal until an agent's browse tools (or the opencode-browser CLI) start one.
      else setStatus(openedAt === undefined ? "offline" : "connecting")
      schedule(quiet && openedAt === undefined)
    }
  }

  /** Capped exponential backoff with jitter; the alarm keeps trying while the worker sleeps. */
  const schedule = (quiet = false) => {
    clearTimeout(retry)
    const base = Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** attempts)
    const delay = Math.round(base * (0.75 + Math.random() * 0.5))
    attempts = Math.min(attempts + 1, 16)
    if (!quiet) log.add("retry", { ms: delay, attempt: attempts })
    retry = setTimeout(() => {
      retry = undefined
      void connect("backoff")
    }, delay)
  }

  const hello = async (current: WebSocket) => {
    const stored = (await chrome.storage.local.get(PROFILE_KEY))[PROFILE_KEY] as { id: string; name?: string } | undefined
    const profile = stored ?? { id: crypto.randomUUID() }
    if (!stored) await chrome.storage.local.set({ [PROFILE_KEY]: profile })
    if (socket !== current || current.readyState !== WebSocket.OPEN) return
    current.send(
      JSON.stringify({
        method: "hello",
        params: {
          version: chrome.runtime.getManifest().version,
          build: __OPENCODE_BROWSER_BUILD__,
          protocolVersion: extensionProtocolVersion,
          profileId: profile.id,
          profileName: profile.name ?? "OpenCode Browser",
        },
      }),
    )
    relayTabs.forEach((tabId) => current.send(JSON.stringify({ method: "debugger.attached", params: { tabId } })))
    current.send(JSON.stringify({ method: "ready" }))
    log.add("hello", { tabs: relayTabs.size, protocol: extensionProtocolVersion })
    clearInterval(keepalive)
    keepalive = setInterval(() => {
      if (socket === current) send({ method: "pong" })
    }, KEEPALIVE)
    connectedAt = Date.now()
    setStatus("connected")
    pendingAttach.forEach((tabId) => send({ method: "toolbar.clicked", params: { tabId } }))
    pendingAttach.clear()
    void ungroupStale().catch((error: unknown) => log.add("ungroupStale.error", { error: text(error) }))
  }

  const handle = async (current: WebSocket, data: string) => {
    const command = (() => {
      try {
        return parseExtensionCommand(data)
      } catch (error) {
        log.add("command.invalid", { error: text(error), data: data.slice(0, 200) })
        current.send(JSON.stringify({ method: "log", params: { level: "error", message: text(error) } }))
        // A command this build doesn't know (an older or newer relay) still gets an answer, so the relay
        // doesn't wait for its timeout.
        const id = (() => {
          try {
            const parsed: unknown = JSON.parse(data)
            return isJsonObject(parsed) && typeof parsed.id === "number" ? parsed.id : undefined
          } catch {
            return undefined
          }
        })()
        if (id !== undefined) current.send(JSON.stringify({ id, error: text(error) }))
        return undefined
      }
    })()
    if (!command) return
    const begin = performance.now()
    const reply = await run(command, current).then(
      (result) => ({ id: command.id, result }),
      (error: unknown) => ({ id: command.id, error: text(error) }),
    )
    const ms = Math.round(performance.now() - begin)
    const failed = "error" in reply
    const cdpMethod = command.method === "debugger.sendCommand" ? command.params?.method : undefined
    if (cdpMethod !== undefined) {
      cdp.count++
      if (failed) cdp.errors++
    }
    if (cdpMethod === undefined || failed || ms >= SLOW_CDP)
      log.add("command", {
        method: command.method,
        cdp: typeof cdpMethod === "string" ? cdpMethod : undefined,
        id: command.id,
        tabId: typeof command.params?.tabId === "number" ? command.params.tabId : undefined,
        ms,
        ok: !failed,
        error: failed ? reply.error : undefined,
      })
    if (socket !== current || current.readyState !== WebSocket.OPEN) return
    // A result larger than the relay accepts (a huge screenshot or response body) fails that one command instead of
    // closing the connection, which would fail every command in flight and make the relay reconnect.
    const serialized = serialize(reply)
    if (serialized === undefined) {
      log.add("command.tooLarge", { method: command.method, id: command.id })
      current.send(JSON.stringify({ id: command.id, error: `Result too large to send (the limit is ${Math.floor(MAX_MESSAGE / 1048576)} MB). Request less data, for example a viewport screenshot instead of a full page.` }))
      return
    }
    current.send(serialized)
  }

  const run = async (command: ExtensionCommand, current: WebSocket): Promise<JsonObject> => {
    const params = command.params
    switch (command.method) {
      case "ping":
        return {}
      case "debugger.attach": {
        const tabId = number(params, "tabId")
        TabCleanup.touch(tabId)
        await DebuggerHub.attach(tabId, OWNER)
        relayTabs.add(tabId)
        notify()
        return {}
      }
      case "debugger.detach": {
        const tabId = number(params, "tabId")
        forget(tabId)
        await DebuggerHub.detach(tabId, OWNER)
        await ungroup(tabId)
        return {}
      }
      case "debugger.sendCommand":
        TabCleanup.touch(number(params, "tabId"))
        return sendCommand(params)
      case "tabs.create": {
        const tab = await chrome.tabs.create({
          url: typeof params?.url === "string" ? params.url : "about:blank",
          active: params?.active === true,
        })
        if (tab.id === undefined) throw new Error("Created tab has no id")
        TabCleanup.track(tab.id)
        return { tabId: tab.id }
      }
      case "tabs.remove":
        await chrome.tabs.remove(number(params, "tabId"))
        return {}
      case "tabs.group":
        return {
          groupId: await group(
            number(params, "tabId"),
            typeof params?.sessionId === "string" ? params.sessionId : undefined,
            current,
          ),
        }
      case "tabs.ungroup":
        await ungroup(number(params, "tabId"))
        return {}
      case "action.setAttached": {
        const tabId = number(params, "tabId")
        if (params?.attached === true) badges.set(tabId, { text: "ON", title: ATTACHED_TITLE })
        if (params?.attached !== true) badges.delete(tabId)
        input.badgesChanged()
        return {}
      }
      case "action.setBadge": {
        const tabId = number(params, "tabId")
        const value = typeof params?.text === "string" ? params.text : ""
        if (!value) badges.delete(tabId)
        // "ON" keeps our title, which says the toolbar button stops agents.
        if (value)
          badges.set(tabId, {
            text: value,
            ...(value === "ON"
              ? { title: ATTACHED_TITLE }
              : typeof params?.title === "string"
                ? { title: params.title }
                : {}),
          })
        input.badgesChanged()
        return {}
      }
      case "pageStatus.set": {
        const tabId = number(params, "tabId")
        const page = pageStatusFromJson(params?.status)
        if (!page) throw new Error("Invalid page status")
        const wasWaiting = pageStatuses.get(tabId)?.state === "waiting"
        pageStatuses.set(tabId, page)
        notify()
        // A handoff opens the agent's group so the user can find the tab; it folds up again afterwards.
        if (page.state === "waiting") void AgentGroups.expandTab(tabId)
        else if (wasWaiting) void AgentGroups.settleTab(tabId)
        await chrome.tabs.sendMessage(tabId, { action: "page-status.set", status: page })
        return {}
      }
      case "pageStatus.clear": {
        const tabId = number(params, "tabId")
        const wasWaiting = pageStatuses.get(tabId)?.state === "waiting"
        pageStatuses.delete(tabId)
        if (wasWaiting) void AgentGroups.settleTab(tabId)
        notify()
        // Restricted pages have no content script; the status is best-effort there.
        await chrome.tabs.sendMessage(tabId, { action: "page-status.clear" }).catch(() => undefined)
        return {}
      }
      case "runtime.reload":
        log.add("runtime.reload")
        // Reloading detaches every tab. Keep the stored attachments (the new worker re-attaches them) and don't
        // tell the relay, which would otherwise drop its sessions' tabs; it gets them back on the next hello.
        reloading = true
        DebuggerHub.freeze()
        setTimeout(() => {
          // Browsers only let pages close with 1000 or 3000-4999; any other code throws and the reload never runs.
          socket?.close(1000, "Extension reloading")
          chrome.runtime.reload()
        }, 50)
        return {}
      case "tabs.cleanup": {
        const minutes = typeof params?.idleMinutes === "number" ? Math.max(0, params.idleMinutes) : undefined
        const closed = await TabCleanup.cleanup(minutes === undefined ? {} : { minutes })
        return { closed: closed.map((tab) => ({ tabId: tab.tabId, title: tab.title, idleMinutes: tab.idleMinutes })) }
      }
      case "recording.start": {
        const result = await startRecording(params)
        if (result.success === true) recordingTabs.add(number(params, "tabId"))
        return result
      }
      case "recording.stop":
        recordingTabs.delete(number(params, "tabId"))
        return recordingCall<OffscreenStopRecordingResult>("recording.stop", number(params, "tabId")).then((result) =>
          result.success ? { success: true, tabId: result.tabId, duration: result.duration } : result,
        )
      case "recording.status": {
        const tabId = number(params, "tabId")
        const result = await recordingCall<OffscreenStatusRecordingResult>("recording.status", tabId)
        return {
          isRecording: result.isRecording,
          tabId,
          ...(result.startedAt === undefined ? {} : { startedAt: result.startedAt }),
        }
      }
      case "recording.cancel":
        recordingTabs.delete(number(params, "tabId"))
        return recordingCall<OffscreenCancelRecordingResult>("recording.cancel", number(params, "tabId")).then((result) =>
          result.success ? { success: true } : result,
        )
    }
  }

  const sendCommand = async (params: JsonObject | undefined): Promise<JsonObject> => {
    const tabId = number(params, "tabId")
    const method = string(params, "method")
    const sessionId = typeof params?.sessionId === "string" ? params.sessionId : undefined
    const cdpParams = isJsonObject(params?.params) ? params.params : undefined
    const debuggee = sessionId ? { tabId, sessionId } : { tabId }
    const call = async () => {
      const result = await chrome.debugger.sendCommand(debuggee, method, cdpParams)
      return isJsonObject(result) ? result : {}
    }
    try {
      return await call()
    } catch (error) {
      if (!FOREIGN_FRAME.test(text(error))) throw error
      for (let attempt = 0; attempt < 2; attempt++) {
        log.add("cdp.recover", { tabId, cdp: method, attempt, error: text(error) })
        await evictForeignFrames(tabId)
        await sleep(45)
        if (sessionId === undefined) await reattach(tabId)
        try {
          return await call()
        } catch (retryError) {
          if (!FOREIGN_FRAME.test(text(retryError))) throw retryError
        }
      }
      // The page keeps a frame the debugger cannot get past; navigating without it still works.
      if (sessionId === undefined && method === "Page.navigate" && typeof cdpParams?.url === "string") {
        log.add("cdp.navigateFallback", { tabId })
        await chrome.tabs.update(tabId, { url: cdpParams.url })
        return { frameId: String(tabId) }
      }
      throw error
    }
  }

  /** Re-attaches the relay to a tab whose debugger dropped; true when it is attached again. */
  const reattach = (tabId: number) =>
    DebuggerHub.attach(tabId, OWNER).then(
      () => {
        if (!relayTabs.has(tabId)) {
          relayTabs.add(tabId)
          notify()
        }
        return true
      },
      (error: unknown) => {
        log.add("reattach.error", { tabId, error: text(error) })
        return false
      },
    )

  const evictForeignFrames = async (tabId: number) => {
    const result: unknown = await chrome.tabs
      .sendMessage(tabId, { action: "evict-extension-frames" })
      .catch(() => undefined)
    const removed = isJsonObject(result) && typeof result.removed === "number" ? result.removed : 0
    if (removed) log.add("evict", { tabId, removed })
  }

  /**
   * Chrome reports a foreign extension frame taking over as target_closed, the same as a closed tab. While
   * the tab still exists, evict the frame and attach again; the relay then verifies the tab is still usable.
   */
  const recover = async (tabId: number, reason: string) => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    let kept = false
    if (tab) {
      await evictForeignFrames(tabId)
      await sleep(45)
      kept = await reattach(tabId)
    }
    if (!kept) forget(tabId)
    log.add("debugger.recovered", { tabId, ok: kept })
    send({ method: "debugger.detached", params: { tabId, reason } })
  }

  const startRecording = async (params: JsonObject | undefined): Promise<JsonObject> => {
    const tabId = number(params, "tabId")
    await ensureOffscreen()
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).catch((error: unknown) => {
      const message = text(error)
      throw new Error(
        /invoked|activeTab/i.test(message)
          ? `${message.replace(/\.+$/, "")}. Click the OpenCode Browser toolbar icon on this tab once before recording.`
          : message,
      )
    })
    const result = (await chrome.runtime.sendMessage({
      action: "recording.start",
      tabId,
      streamId,
      frameRate: typeof params?.frameRate === "number" ? params.frameRate : 30,
      videoBitsPerSecond: typeof params?.videoBitsPerSecond === "number" ? params.videoBitsPerSecond : 2_500_000,
      audioBitsPerSecond: typeof params?.audioBitsPerSecond === "number" ? params.audioBitsPerSecond : 128_000,
      audio: params?.audio === true,
    })) as OffscreenStartRecordingResult
    if (!result.success) return { success: false, error: result.error }
    return { success: true, tabId: result.tabId, startedAt: result.startedAt, mimeType: result.mimeType }
  }

  const recordingCall = async <Result>(action: string, tabId: number) =>
    (await chrome.runtime.sendMessage({ action, tabId })) as Result

  const ensureOffscreen = async () => {
    const url = chrome.runtime.getURL("offscreen.html")
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [url],
    })
    if (existing.length) return
    offscreen ??= chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "Record tabs for agents with chrome.tabCapture and MediaRecorder",
      })
      .finally(() => {
        offscreen = undefined
      })
    await offscreen
  }

  const sendRecordingChunk = async (data: Uint8Array) => {
    const current = open()
    if (!current) throw new Error("The OpenCode Browser relay is not connected")
    const deadline = Date.now() + 30_000
    while (current.bufferedAmount + data.byteLength > MAX_RECORDING_BUFFER) {
      await sleep(10)
      if (socket !== current || current.readyState !== WebSocket.OPEN)
        throw new Error("The OpenCode Browser relay disconnected while receiving recording data")
      if (Date.now() >= deadline) throw new Error("Timed out sending recording data to the OpenCode Browser relay")
    }
    current.send(new Uint8Array(data))
  }

  const group = async (tabId: number, sessionId: string | undefined, current: WebSocket) => {
    const tab = await chrome.tabs.get(tabId)
    const title = groupTitle(sessionId, tab.url)
    const key = sessionId ?? ""
    const known = sessionGroups.get(key)
    const target = known === undefined ? undefined : await chrome.tabGroups.get(known).catch(() => undefined)
    if (target && target.windowId === tab.windowId && ownedGroup(target.title)) {
      if (tab.groupId !== target.id) await chrome.tabs.group({ tabIds: [tabId], groupId: target.id })
      if (target.title !== title) await chrome.tabGroups.update(target.id, { title, color: GROUP_COLOR })
      await AgentGroups.adopt(target.id)
      return target.id
    }
    if (socket !== current) throw new Error("The relay reconnected while grouping the tab")
    const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } })
    // chrome.tabs.group changes the tab before it resolves, so a stale command undoes its anonymous group.
    if (socket !== current) {
      await chrome.tabs.ungroup(tabId).catch(() => undefined)
      throw new Error("The relay reconnected while grouping the tab")
    }
    await chrome.tabGroups.update(groupId, { title, color: GROUP_COLOR })
    sessionGroups.set(key, groupId)
    await AgentGroups.adopt(groupId)
    return groupId
  }

  /** Auto-named sessions take their group name from the site the agent is on, so it follows navigation. */
  const renameForPage = async (tabId: number, url: string | undefined) => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    const sessionId = Array.from(sessionGroups).find(([, id]) => id === tab.groupId)?.[0]
    if (sessionId === undefined || !autoNamed(sessionId)) return
    const current = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
    const title = groupTitle(sessionId, url)
    if (current && ownedGroup(current.title) && current.title !== title)
      await chrome.tabGroups.update(current.id, { title }).catch(() => undefined)
  }

  /**
   * The relay is done with a tab. A tab an agent opened closes with its group rather than spilling into the
   * user's tabs; a tab the user lent an agent just leaves the group.
   */
  const ungroup = async (tabId: number) => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    const current = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
    if (!ownedGroup(current?.title)) return
    if (!reloading && (await TabCleanup.isTracked(tabId))) {
      log.add("tab.closed", { tabId, reason: "agent finished with it" })
      await chrome.tabs.remove(tabId).catch(() => undefined)
      return
    }
    await chrome.tabs.ungroup(tabId).catch(() => undefined)
  }

  /**
   * After a restart, relay groups may hold tabs the relay no longer uses. Tabs an agent opened stay in their group
   * (the relay reclaims a named session's tabs, and idle cleanup closes the rest), so a restart never leaves loose
   * agent tabs behind; a tab the user lent an agent goes back to being an ordinary tab.
   */
  const ungroupStale = async () => {
    const groups = (await chrome.tabGroups.query({})).filter((item) => ownedGroup(item.title))
    for (const item of groups)
      for (const tab of await chrome.tabs.query({ groupId: item.id }))
        if (tab.id !== undefined && !relayTabs.has(tab.id) && !(await TabCleanup.isTracked(tab.id)))
          await chrome.tabs.ungroup(tab.id).catch(() => undefined)
  }

  // Listeners live as long as the worker, not a connection, so reconnects never add more.
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId === undefined || !relayTabs.has(source.tabId)) return
    send({
      method: "debugger.event",
      params: {
        tabId: source.tabId,
        method,
        params: isJsonObject(params) ? params : {},
        ...(source.sessionId === undefined ? {} : { sessionId: source.sessionId }),
      },
    })
  })
  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source.tabId
    if (reloading || tabId === undefined || !relayTabs.has(tabId)) return
    const sessionId = (source as chrome.debugger.DebuggerSession).sessionId
    log.add("debugger.detached", { tabId, reason, sessionId })
    if (sessionId !== undefined) {
      send({ method: "debugger.detached", params: { tabId, reason, sessionId } })
      return
    }
    if (reason === "target_closed") {
      void recover(tabId, reason)
      return
    }
    forget(tabId)
    send({ method: "debugger.detached", params: { tabId, reason } })
  })
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url && relayTabs.has(tabId)) void renameForPage(tabId, change.url)
  })
  TabCleanup.guard((tabId) => recordingTabs.has(tabId) || pageStatuses.get(tabId)?.state === "waiting")
  AgentGroups.keepOpenWhile((tabId) => pageStatuses.get(tabId)?.state === "waiting")
  chrome.tabs.onRemoved.addListener((tabId) => {
    recordingTabs.delete(tabId)
    void chrome.runtime.sendMessage({ action: "recording.cancel", tabId }).catch(() => undefined)
    if (relayTabs.has(tabId)) log.add("tab.removed", { tabId })
    forget(tabId)
    pendingAttach.delete(tabId)
    if (badges.delete(tabId)) input.badgesChanged()
    send({ method: "tabs.removed", params: { tabId } })
  })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM && !retry) void connect("alarm")
  })
  void chrome.alarms.create(ALARM, { periodInMinutes: extensionReconnectAlarmPeriodMs / 60_000 })
  void DebuggerHub.restore().then(() => {
    DebuggerHub.tabsOwnedBy(OWNER).forEach((tabId) => relayTabs.add(tabId))
    log.add("worker.start", { restoredTabs: relayTabs.size })
    return connect("startup")
  })

  return {
    state: snapshot,
    badge: (tabId: number) => badges.get(tabId),
    /** The user lets agents use this tab, or stops them (the toolbar button); toggles. */
    attachTab(tabId: number) {
      log.add("attach.requested", { tabId, connected: !!open() })
      if (open() && status === "connected") return send({ method: "toolbar.clicked", params: { tabId } })
      // No relay yet: the click is queued until one starts; a second click takes it back.
      if (pendingAttach.delete(tabId)) return
      pendingAttach.add(tabId)
      attempts = 0
      void connect("attach")
    },
    /**
     * Content-script and offscreen messages. Returns undefined when the message isn't for the relay link, true when
     * the answer comes later through sendResponse (keep the channel open), and false when it was handled.
     */
    runtimeMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) {
      if (!isJsonObject(message)) return undefined
      const tabId = sender.tab?.id
      if (message.action === "page-status.ready") {
        if (typeof tabId === "number" && relayTabs.has(tabId)) {
          const page = pageStatuses.get(tabId)
          if (page) void chrome.tabs.sendMessage(tabId, { action: "page-status.set", status: page }).catch(() => undefined)
          send({ method: "pageStatus.requested", params: { tabId } })
        }
        return false
      }
      if (message.action === "handoff.complete") {
        if (typeof tabId === "number" && typeof message.handoffId === "string") {
          log.add("handoff.completed", { tabId, from: "page" })
          send({ method: "handoff.completed", params: { tabId, handoffId: message.handoffId } })
        }
        return false
      }
      const offscreenMessage = message as unknown as OffscreenOutgoingMessage
      if (offscreenMessage.action === "recording.chunk") {
        // The recording document waits for this answer before it sends the next chunk.
        void sendRecordingChunk(
          encodeRecordingFrame({
            tabId: offscreenMessage.tabId,
            sequence: offscreenMessage.sequence,
            final: offscreenMessage.final,
            payload: offscreenMessage.final
              ? new Uint8Array()
              : Uint8Array.from(atob(offscreenMessage.dataBase64), (char) => char.charCodeAt(0)),
          }),
        ).then(
          () => sendResponse({ success: true }),
          (error: unknown) => {
            log.add("recording.chunk.error", { tabId: offscreenMessage.tabId, error: text(error) })
            sendResponse({ success: false, error: text(error) })
          },
        )
        return true
      }
      if (offscreenMessage.action === "recording.cancelled") {
        log.add("recording.cancelled", { tabId: offscreenMessage.tabId })
        recordingTabs.delete(offscreenMessage.tabId)
        send({ method: "recording.cancelled", params: { tabId: offscreenMessage.tabId } })
        return false
      }
      return undefined
    },
    /** Reconnects now, for example after the user fixed what blocked the connection. */
    reconnect() {
      log.add("reconnect.requested")
      attempts = 0
      clearTimeout(retry)
      retry = undefined
      void connect("user")
    },
    /** A plain-text report for bug reports: versions, connection state, tabs, and the recent log. */
    async diagnostics() {
      const entries = await log.entries()
      const manifest = chrome.runtime.getManifest()
      return [
        "OpenCode Browser diagnostics",
        `extension: ${manifest.version} (${chrome.runtime.id})`,
        `browser: ${navigator.userAgent}`,
        `relay: ws://127.0.0.1:${port}/extension, protocol ${extensionProtocolVersion}`,
        `status: ${status}${connectedAt ? ` since ${new Date(connectedAt).toISOString()}` : ""}`,
        `reconnect attempts: ${attempts}${retry ? " (retry scheduled)" : ""}`,
        `cdp commands: ${cdp.count} (${cdp.errors} failed)`,
        `agent tabs: ${
          Array.from(relayTabs, (tabId) => {
            const page = pageStatuses.get(tabId)
            return page ? `${tabId} ${page.state}${page.readOnly ? " read-only" : ""}` : String(tabId)
          }).join(", ") || "none"
        }`,
        `generated: ${new Date().toISOString()}`,
        "",
        `log (last ${entries.length}):`,
        formatAgentRelayLog(entries),
      ].join("\n")
    },
  }
}

declare const __OPENCODE_BROWSER_BUILD__: string

/**
 * JSON for the relay, or undefined when it's larger than the relay accepts (or too large for V8 to serialize at
 * all). Measuring UTF-8 is costly, so it only happens when the text could be over the limit.
 */
function serialize(message: JsonObject) {
  const data = (() => {
    try {
      return JSON.stringify(message)
    } catch {
      return undefined
    }
  })()
  if (data === undefined) return undefined
  // Each UTF-16 unit is 1-3 UTF-8 bytes, so only the window in between needs measuring.
  if (data.length * 3 <= MAX_MESSAGE) return data
  if (data.length > MAX_MESSAGE) return undefined
  return new TextEncoder().encode(data).byteLength <= MAX_MESSAGE ? data : undefined
}

const ATTACHED_TITLE = "OpenCode Browser · Agents can use this tab. Click to stop."

/** Session ids the relay or MCP server made up (mcp-1a2b3c4d, quiet-falcon-333), rather than an agent's chosen name. */
function autoNamed(sessionId: string | undefined) {
  return !sessionId || /^mcp-[0-9a-f]{6,}$/i.test(sessionId) || /^[a-z]+-[a-z]+-\d{3}$/.test(sessionId)
}

/**
 * The tab group's name: the session's name when an agent chose one ("github"), else "Agent · <site>" for the
 * page it is on, else "Agent". The trailing marker identifies the relay's groups.
 */
function groupTitle(sessionId: string | undefined, url?: string) {
  const host = url && /^https?:/.test(url) ? new URL(url).hostname.replace(/^www\./, "") : undefined
  const name = autoNamed(sessionId) ? (host ? `Agent · ${host}` : "Agent") : sessionId!.trim()
  return `${name.length > 28 ? `${name.slice(0, 27)}…` : name}${GROUP_MARKER}`
}

function ownedGroup(title: string | undefined) {
  return !!title?.endsWith(GROUP_MARKER)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function text(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function number(params: JsonObject | undefined, key: string) {
  const value = params?.[key]
  if (typeof value !== "number") throw new Error(`Missing number param: ${key}`)
  return value
}

function string(params: JsonObject | undefined, key: string) {
  const value = params?.[key]
  if (typeof value !== "string") throw new Error(`Missing string param: ${key}`)
  return value
}
