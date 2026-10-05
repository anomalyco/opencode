// The Browser Control relay link. OpenCode Browser replaces Browser Control's own extension: it connects to
// the local relay (ws://127.0.0.1:19989/extension) and runs its commands, so the relay's CLI, MCP server,
// and Playwright `execute` drive tabs through this extension. Ported from anomalyco/browser-control
// extension/src/background.ts; the relay's protocol is in ../browser-control/protocol.ts.
import {
  encodeRecordingFrame,
  extensionProtocolVersion,
  isJsonObject,
  pageStatusFromJson,
  parseExtensionCommand,
  type ExtensionCommand,
  type JsonObject,
  type PageStatus,
} from "../browser-control/protocol"
import type {
  OffscreenCancelRecordingResult,
  OffscreenOutgoingMessage,
  OffscreenStartRecordingResult,
  OffscreenStatusRecordingResult,
  OffscreenStopRecordingResult,
} from "../browser-control/recording-types"
import type { RelayState, RelayStatus } from "../shared/protocol"
import { DebuggerHub } from "./debugger-hub"

/** Badge text and color the relay asked for, by tab; merged with the site-script count by the caller. */
export type RelayBadge = { text: string; color?: string; title?: string }

const OWNER = "relay"
const PORT_KEY = "browserControlPort"
const PROFILE_KEY = "browserControlProfile"
const ALARM = "opencode-browser-relay"
// A marker character Chrome renders without width, so relay groups look like the session groups ("opencode")
// but stay distinguishable for cleanup.
const GROUP_TITLE = "opencode\u2063"
const MAX_RECORDING_BUFFER = 16 * 1024 * 1024

export function createBrowserControl(input: {
  changed: (state: RelayState) => void
  badgesChanged: () => void
}) {
  let socket: WebSocket | undefined
  let generation = 0
  let status: RelayStatus = "offline"
  let retry: ReturnType<typeof setTimeout> | undefined
  let keepalive: ReturnType<typeof setInterval> | undefined
  let offscreen: Promise<void> | undefined
  const relayTabs = new Set<number>()
  const pageStatuses = new Map<number, PageStatus>()
  const badges = new Map<number, RelayBadge>()

  const snapshot = (): RelayState => ({
    status,
    tabs: Array.from(relayTabs, (tabId) => {
      const page = pageStatuses.get(tabId)
      return page ? { tabId, status: page } : { tabId }
    }),
  })
  const notify = () => input.changed(snapshot())
  const setStatus = (next: RelayStatus) => {
    if (status === next) return
    status = next
    notify()
  }

  const open = () => (socket?.readyState === WebSocket.OPEN ? socket : undefined)
  const send = (message: JsonObject) => {
    open()?.send(JSON.stringify(message))
  }

  const connect = async () => {
    if (socket && socket.readyState <= WebSocket.OPEN) return
    clearTimeout(retry)
    const port = Number((await chrome.storage.local.get(PORT_KEY))[PORT_KEY]) || 19989
    const current = new WebSocket(`ws://127.0.0.1:${port}/extension`)
    const mine = ++generation
    let opened = false
    socket = current
    current.onopen = () => {
      opened = true
      void hello(current).catch(() => current.close(1011, "Handshake failed"))
    }
    current.onmessage = (event) => {
      if (typeof event.data === "string") void handle(current, event.data)
    }
    current.onclose = (event) => {
      if (socket !== current || generation !== mine) return
      socket = undefined
      clearInterval(keepalive)
      void chrome.runtime.sendMessage({ action: "recording.cancelAll" }).catch(() => undefined)
      if (event.code === 4003) return setStatus("incompatible")
      if (event.code === 4004) setStatus("conflict")
      if (event.code !== 4004 && !opened) void probe(port)
      if (event.code !== 4004 && opened) setStatus("connecting")
      // A missing relay is normal until Browser Control's CLI or MCP server starts one; retry gently.
      retry = setTimeout(() => void connect(), opened ? 1_000 : 5_000)
    }
  }

  /** Tells a stopped relay apart from one that refused this extension's origin. */
  const probe = async (port: number) => {
    const running = await fetch(`http://127.0.0.1:${port}/version`).then(
      (response) => response.ok,
      () => false,
    )
    setStatus(running ? "rejected" : "offline")
  }

  const hello = async (current: WebSocket) => {
    const stored = (await chrome.storage.local.get(PROFILE_KEY))[PROFILE_KEY] as { id: string; name?: string } | undefined
    const profile = stored ?? { id: crypto.randomUUID() }
    if (!stored) await chrome.storage.local.set({ [PROFILE_KEY]: profile })
    current.send(
      JSON.stringify({
        method: "hello",
        params: {
          version: chrome.runtime.getManifest().version,
          protocolVersion: extensionProtocolVersion,
          profileId: profile.id,
          profileName: profile.name ?? "OpenCode Browser",
        },
      }),
    )
    relayTabs.forEach((tabId) => current.send(JSON.stringify({ method: "debugger.attached", params: { tabId } })))
    current.send(JSON.stringify({ method: "ready" }))
    clearInterval(keepalive)
    keepalive = setInterval(() => send({ method: "pong" }), 20_000)
    setStatus("connected")
    void ungroupStale()
  }

  const handle = async (current: WebSocket, data: string) => {
    const command = (() => {
      try {
        return parseExtensionCommand(data)
      } catch (error) {
        current.send(JSON.stringify({ method: "log", params: { level: "error", message: String(error) } }))
        return undefined
      }
    })()
    if (!command) return
    const reply = await run(command).then(
      (result) => ({ id: command.id, result }),
      (error: unknown) => ({ id: command.id, error: error instanceof Error ? error.message : String(error) }),
    )
    if (socket === current) current.send(JSON.stringify(reply))
  }

  const run = async (command: ExtensionCommand): Promise<JsonObject> => {
    const params = command.params
    switch (command.method) {
      case "ping":
        return {}
      case "debugger.attach": {
        const tabId = number(params, "tabId")
        await DebuggerHub.attach(tabId, OWNER)
        relayTabs.add(tabId)
        notify()
        return {}
      }
      case "debugger.detach": {
        const tabId = number(params, "tabId")
        relayTabs.delete(tabId)
        pageStatuses.delete(tabId)
        await DebuggerHub.detach(tabId, OWNER)
        await ungroup(tabId)
        notify()
        return {}
      }
      case "debugger.sendCommand": {
        const tabId = number(params, "tabId")
        const sessionId = typeof params?.sessionId === "string" ? params.sessionId : undefined
        const result = await chrome.debugger.sendCommand(
          sessionId ? { tabId, sessionId } : { tabId },
          string(params, "method"),
          isJsonObject(params?.params) ? params.params : undefined,
        )
        return isJsonObject(result) ? result : {}
      }
      case "tabs.create": {
        const tab = await chrome.tabs.create({
          url: typeof params?.url === "string" ? params.url : "about:blank",
          active: params?.active === true,
        })
        if (tab.id === undefined) throw new Error("Created tab has no id")
        return { tabId: tab.id }
      }
      case "tabs.remove":
        await chrome.tabs.remove(number(params, "tabId"))
        return {}
      case "tabs.group":
        return { groupId: await group(number(params, "tabId")) }
      case "tabs.ungroup":
        await ungroup(number(params, "tabId"))
        return {}
      case "action.setAttached": {
        const tabId = number(params, "tabId")
        if (params?.attached === true) badges.set(tabId, { text: "ON", title: "Browser Control can use this tab" })
        if (params?.attached !== true) badges.delete(tabId)
        input.badgesChanged()
        return {}
      }
      case "action.setBadge": {
        const tabId = number(params, "tabId")
        const text = typeof params?.text === "string" ? params.text : ""
        if (!text) badges.delete(tabId)
        if (text)
          badges.set(tabId, {
            text,
            ...(typeof params?.title === "string" ? { title: params.title } : {}),
          })
        input.badgesChanged()
        return {}
      }
      case "pageStatus.set": {
        const tabId = number(params, "tabId")
        const status = pageStatusFromJson(params?.status)
        if (!status) throw new Error("Invalid page status")
        pageStatuses.set(tabId, status)
        notify()
        await chrome.tabs.sendMessage(tabId, { action: "page-status.set", status })
        return {}
      }
      case "pageStatus.clear": {
        const tabId = number(params, "tabId")
        pageStatuses.delete(tabId)
        notify()
        await chrome.tabs.sendMessage(tabId, { action: "page-status.clear" }).catch(() => undefined)
        return {}
      }
      case "runtime.reload":
        chrome.runtime.reload()
        return {}
      case "profile.rename": {
        const stored = (await chrome.storage.local.get(PROFILE_KEY))[PROFILE_KEY] as { id: string } | undefined
        if (stored) await chrome.storage.local.set({ [PROFILE_KEY]: { ...stored, name: string(params, "name") } })
        return {}
      }
      case "recording.start":
        return startRecording(params)
      case "recording.stop":
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
        return recordingCall<OffscreenCancelRecordingResult>("recording.cancel", number(params, "tabId")).then((result) =>
          result.success ? { success: true } : result,
        )
    }
  }

  const startRecording = async (params: JsonObject | undefined): Promise<JsonObject> => {
    const tabId = number(params, "tabId")
    await ensureOffscreen()
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      throw new Error(
        /invoked|activeTab/i.test(text)
          ? `${text}. Click the OpenCode Browser toolbar icon on this tab once before recording.`
          : text,
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
        justification: "Record tabs for Browser Control with chrome.tabCapture and MediaRecorder",
      })
      .finally(() => {
        offscreen = undefined
      })
    await offscreen
  }

  const sendRecordingChunk = async (data: Uint8Array) => {
    const current = open()
    if (!current) throw new Error("Browser Control relay is not connected")
    const deadline = Date.now() + 30_000
    while (current.bufferedAmount + data.byteLength > MAX_RECORDING_BUFFER) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (socket !== current || current.readyState !== WebSocket.OPEN)
        throw new Error("Browser Control relay disconnected while sending recording data")
      if (Date.now() >= deadline) throw new Error("Timed out sending recording data to the Browser Control relay")
    }
    current.send(new Uint8Array(data))
  }

  const group = async (tabId: number) => {
    const tab = await chrome.tabs.get(tabId)
    const existing = (await chrome.tabGroups.query({ windowId: tab.windowId })).find((item) => item.title === GROUP_TITLE)
    if (tab.groupId === existing?.id) return existing.id
    const groupId = await chrome.tabs.group({ tabIds: [tabId], ...(existing ? { groupId: existing.id } : {}) })
    await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: "grey" })
    return groupId
  }

  const ungroup = async (tabId: number) => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    const current = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
    if (current?.title === GROUP_TITLE) await chrome.tabs.ungroup(tabId).catch(() => undefined)
  }

  /** After a restart, relay groups may hold tabs the relay no longer controls. */
  const ungroupStale = async () => {
    const groups = (await chrome.tabGroups.query({})).filter((item) => item.title === GROUP_TITLE)
    for (const item of groups)
      for (const tab of await chrome.tabs.query({ groupId: item.id }))
        if (tab.id !== undefined && !relayTabs.has(tab.id)) await chrome.tabs.ungroup(tab.id).catch(() => undefined)
  }

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
    if (source.tabId === undefined || !relayTabs.has(source.tabId)) return
    relayTabs.delete(source.tabId)
    pageStatuses.delete(source.tabId)
    notify()
    send({ method: "debugger.detached", params: { tabId: source.tabId, reason } })
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.runtime.sendMessage({ action: "recording.cancel", tabId }).catch(() => undefined)
    if (relayTabs.delete(tabId)) notify()
    pageStatuses.delete(tabId)
    badges.delete(tabId)
    send({ method: "tabs.removed", params: { tabId } })
  })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void connect()
  })
  void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 })
  void DebuggerHub.restore().then(() => {
    DebuggerHub.tabsOwnedBy(OWNER).forEach((tabId) => relayTabs.add(tabId))
    return connect()
  })

  return {
    state: snapshot,
    badge: (tabId: number) => badges.get(tabId),
    /** The user lets Browser Control sessions use this tab (Browser Control's toolbar action). */
    attachTab(tabId: number) {
      send({ method: "toolbar.clicked", params: { tabId } })
    },
    /** Content-script and offscreen messages; returns true when the message was for Browser Control. */
    runtimeMessage(message: unknown, sender: chrome.runtime.MessageSender) {
      if (!isJsonObject(message)) return false
      const tabId = sender.tab?.id
      if (message.action === "page-status.ready") {
        if (typeof tabId === "number" && relayTabs.has(tabId)) {
          const page = pageStatuses.get(tabId)
          if (page) void chrome.tabs.sendMessage(tabId, { action: "page-status.set", status: page }).catch(() => undefined)
          send({ method: "pageStatus.requested", params: { tabId } })
        }
        return true
      }
      if (message.action === "handoff.complete") {
        if (typeof tabId === "number" && typeof message.handoffId === "string")
          send({ method: "handoff.completed", params: { tabId, handoffId: message.handoffId } })
        return true
      }
      const offscreenMessage = message as unknown as OffscreenOutgoingMessage
      if (offscreenMessage.action === "recording.chunk") {
        void sendRecordingChunk(
          encodeRecordingFrame({
            tabId: offscreenMessage.tabId,
            sequence: offscreenMessage.sequence,
            final: offscreenMessage.final,
            payload: offscreenMessage.final
              ? new Uint8Array()
              : Uint8Array.from(atob(offscreenMessage.dataBase64), (char) => char.charCodeAt(0)),
          }),
        ).catch(() => undefined)
        return true
      }
      if (offscreenMessage.action === "recording.cancelled") {
        send({ method: "recording.cancelled", params: { tabId: offscreenMessage.tabId } })
        return true
      }
      return false
    },
    /** Completes a handoff from the side panel (the same as the page's Continue button). */
    completeHandoff(tabId: number) {
      const page = pageStatuses.get(tabId)
      if (page?.handoffId) send({ method: "handoff.completed", params: { tabId, handoffId: page.handoffId } })
    },
    reconnect: () => void connect(),
  }
}

export type BrowserControl = ReturnType<typeof createBrowserControl>

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
