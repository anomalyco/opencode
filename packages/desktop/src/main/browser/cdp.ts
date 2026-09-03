import type { WebContents } from "electron"
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js"

export type Cdp = ReturnType<typeof createCdp>

export function createCdp(contents: WebContents) {
  const listeners = new Map<string, Set<(params: unknown, sessionID?: string) => void>>()
  const sessions = new Set([""])
  const receive = (_event: Electron.Event, name: string, params: unknown, sessionID?: string) => {
    if (!sessions.has(sessionID ?? "")) return
    if (name === "Target.attachedToTarget") {
      const event = params as ProtocolMapping.Events["Target.attachedToTarget"][0]
      if (event.targetInfo.type === "iframe") sessions.add(event.sessionId)
    }
    if (name === "Target.detachedFromTarget")
      sessions.delete((params as ProtocolMapping.Events["Target.detachedFromTarget"][0]).sessionId)
    listeners.get(name)?.forEach((callback) => callback(params, sessionID || undefined))
  }
  contents.debugger.on("message", receive)
  return {
    async send<Method extends keyof ProtocolMapping.Commands>(
      method: Method,
      params: object = {},
      sessionID?: string,
    ): Promise<ProtocolMapping.Commands[Method]["returnType"]> {
      if (contents.isDestroyed()) throw new Error("Browser tab was closed.")
      if (!contents.debugger.isAttached()) contents.debugger.attach("1.3")
      // Electron is the CDP boundary. Its native response follows the selected protocol method.
      const result = contents.debugger.sendCommand(method, params, sessionID)
      if (method !== "Page.captureScreenshot") return result
      // Keep a hidden view's compositor awake for CDP (including Lighthouse's
      // screenshot gatherer) without changing the selected Review tab.
      const [capture] = await Promise.all([
        result,
        contents.capturePage(undefined, { stayHidden: false, stayAwake: true }),
      ])
      return capture
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
    dispose() {
      contents.debugger.off("message", receive)
      listeners.clear()
    },
  }
}

export function abortError(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Browser operation was cancelled.")
}

export async function waitFor(check: () => boolean | Promise<boolean>, signal: AbortSignal, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    abortError(signal)
    if (Date.now() >= deadline) throw new Error(`Condition was not met within ${timeoutMs} ms.`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  abortError(signal)
}
