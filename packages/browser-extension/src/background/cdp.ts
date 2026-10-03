import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js"
import { DebuggerHub } from "./debugger-hub"
import { protocolError } from "./errors"

export type Cdp = ReturnType<typeof createCdp>

/**
 * chrome.debugger for one tab, shaped like the desktop's Electron CDP wrapper so the page logic
 * ports unchanged. Attaches lazily on the first command; Chrome shows its "is debugging this
 * browser" bar while any tab is attached.
 */
export function createCdp(tabId: number, options: { detached: (reason: string) => void }) {
  const listeners = new Map<string, Set<(params: unknown, sessionID?: string) => void>>()
  const sessions = new Set([""])
  const state: { attaching?: Promise<void>; attached: boolean; disposed: boolean } = {
    attached: false,
    disposed: false,
  }
  const receive = (source: chrome.debugger.DebuggerSession, name: string, params?: object) => {
    if (source.tabId !== tabId) return
    const sessionID = source.sessionId
    if (!sessions.has(sessionID ?? "")) return
    if (name === "Target.attachedToTarget") {
      const event = params as ProtocolMapping.Events["Target.attachedToTarget"][0]
      if (event.targetInfo.type === "iframe") sessions.add(event.sessionId)
    }
    if (name === "Target.detachedFromTarget")
      sessions.delete((params as ProtocolMapping.Events["Target.detachedFromTarget"][0]).sessionId)
    listeners.get(name)?.forEach((callback) => callback(params, sessionID || undefined))
  }
  const detach = (source: chrome.debugger.Debuggee, reason: string) => {
    if (source.tabId !== tabId) return
    state.attached = false
    state.attaching = undefined
    sessions.clear()
    sessions.add("")
    if (!state.disposed) options.detached(reason)
  }
  chrome.debugger.onEvent.addListener(receive)
  chrome.debugger.onDetach.addListener(detach)

  // Every page registers as its own owner, so the Browser Control relay or another session on the same tab
  // keeps the shared attachment alive when this page lets go.
  const owner = `page:${crypto.randomUUID()}`
  const attach = () => {
    if (state.attached && DebuggerHub.isOwner(tabId, owner)) return Promise.resolve()
    state.attaching ??= DebuggerHub.attach(tabId, owner).then(
      () => {
        state.attached = true
      },
      (error: unknown) => {
        state.attaching = undefined
        throw error
      },
    )
    return state.attaching
  }

  return {
    get attached() {
      return state.attached
    },
    attach,
    async send<Method extends keyof ProtocolMapping.Commands>(
      method: Method,
      params: object = {},
      sessionID?: string,
    ): Promise<ProtocolMapping.Commands[Method]["returnType"]> {
      if (state.disposed)
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID, or browser.tabs.open({}) if no tabs remain.",
        )
      await attach()
      const target: chrome.debugger.DebuggerSession = sessionID ? { tabId, sessionId: sessionID } : { tabId }
      return chrome.debugger
        .sendCommand(target, method, params as Record<string, unknown>)
        .then((result) => result as ProtocolMapping.Commands[Method]["returnType"])
        .catch((error: unknown) => {
          throw protocolError(method, error)
        })
    },
    on<Method extends keyof ProtocolMapping.Events>(
      method: Method,
      callback: (params: ProtocolMapping.Events[Method][0], sessionID?: string) => void,
    ) {
      const handler = (params: unknown, sessionID?: string) =>
        callback(params as ProtocolMapping.Events[Method][0], sessionID)
      const handlers = listeners.get(method) ?? new Set()
      handlers.add(handler)
      listeners.set(method, handlers)
      return () => {
        handlers.delete(handler)
        if (!handlers.size) listeners.delete(method)
      }
    },
    async dispose() {
      if (state.disposed) return
      state.disposed = true
      chrome.debugger.onEvent.removeListener(receive)
      chrome.debugger.onDetach.removeListener(detach)
      listeners.clear()
      if (state.attached) await DebuggerHub.detach(tabId, owner)
      state.attached = false
    },
  }
}

export function abortError(signal: AbortSignal) {
  if (signal.aborted)
    throw new Error(
      "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
    )
}

export async function waitFor(check: () => boolean | Promise<boolean>, signal: AbortSignal, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  const timeout = () => new Error(`Condition was not met within ${timeoutMs} ms.`)
  // A busy renderer can hold one check past the deadline, so each check races the remaining time.
  while (true) {
    abortError(signal)
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw timeout()
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeout()), remaining)
    })
    if (await Promise.race([check(), expired]).finally(() => clearTimeout(timer))) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
