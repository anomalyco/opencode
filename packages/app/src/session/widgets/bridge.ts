import { Widget } from "@opencode/schema/widget"
import type { ServerSDK } from "@/runtime/server/client"
import type { WidgetCapability } from "./grants"

// The widget bridge is a small postMessage protocol between the app (parent) and
// a widget frame. A widget never receives the server credential unless the user
// grants "full"; instead it asks the parent to perform a whitelisted operation.
// The parent validates the message source, checks the granted capability, and
// runs the call against the same SDK the rest of the app uses. The message
// strings and the widget-side helper live in the shared schema so the server can
// serve the helper from one source of truth.

type BridgeRequest = {
  readonly type: typeof Widget.BRIDGE.request
  readonly id: string
  readonly method: string
  readonly params?: unknown
}

type BridgeResponse = {
  readonly type: typeof Widget.BRIDGE.response
  readonly id: string
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: string
}

type BridgeEvent = {
  readonly type: typeof Widget.BRIDGE.event
  readonly name: string
  readonly payload: unknown
}

// Methods a widget may call and the capability each one needs. "write" implies
// "read", so read-only methods require at least the read grant.
const METHODS: Record<string, WidgetCapability> = {
  "session.current": "read",
  "session.messages": "read",
  "session.status": "read",
  "location.get": "read",
  "widget.context": "read",
  "session.prompt": "write",
  "session.command": "write",
  "session.interrupt": "write",
  "session.switchAgent": "write",
  "session.switchModel": "write",
}

export type BridgeContext = {
  readonly server: ServerSDK
  readonly directory: string
  readonly sessionID: string
  readonly widgetID: string
  readonly capabilities: readonly WidgetCapability[]
}

function isRequest(value: unknown): value is BridgeRequest {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return message.type === Widget.BRIDGE.request && typeof message.id === "string" && typeof message.method === "string"
}

// SDK results are decoded Schema class instances that may carry values
// postMessage cannot structured-clone. Widgets consume plain JSON, so normalize
// to a JSON-safe shape before crossing the frame boundary.
function toTransferable(value: unknown): unknown {
  if (value === undefined || value === null) return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

async function invoke(context: BridgeContext, method: string, params: unknown): Promise<unknown> {
  const required = METHODS[method]
  if (!required) throw new Error(`Unknown widget method: ${method}`)
  if (!context.capabilities.includes(required)) throw new Error(`Widget is not granted "${required}" access`)
  const sessionID = context.sessionID
  const input = (params ?? {}) as Record<string, unknown>

  switch (method) {
    case "session.current":
      return context.server.api.session.get({ sessionID })
    case "session.messages":
      return context.server.api.message.list({ sessionID, limit: 100, order: "desc" })
    case "session.status":
      return { sessionID }
    case "location.get":
      return { directory: context.directory }
    case "widget.context":
      return { id: context.widgetID, capabilities: context.capabilities }
    case "session.prompt":
      return context.server.api.session.prompt({ sessionID, text: String(input.text ?? "") })
    case "session.command":
      return context.server.api.session.command({ sessionID, name: String(input.name ?? ""), text: input.text as never })
    case "session.interrupt":
      return context.server.api.session.interrupt({ sessionID })
    case "session.switchAgent":
      return context.server.api.session.switchAgent({ sessionID, agent: String(input.agent ?? "") })
    case "session.switchModel":
      return context.server.api.session.switchModel({ sessionID, model: input.model as never })
    default:
      throw new Error(`Unknown widget method: ${method}`)
  }
}

/**
 * Installs the parent side of the widget bridge for one frame. Returns a cleanup
 * that removes the listener, plus a `publish` for forwarding live events.
 */
export function createWidgetBridge(input: {
  readonly frame: () => HTMLIFrameElement | undefined
  readonly context: () => BridgeContext
}) {
  const post = (message: BridgeResponse | BridgeEvent) => {
    input.frame()?.contentWindow?.postMessage(message, "*")
  }

  const onMessage = (event: MessageEvent) => {
    // The frame runs with an opaque origin, so its messages arrive with
    // origin "null" and cannot be authenticated by origin. The source window is
    // the only trustworthy check.
    const frame = input.frame()
    if (!frame || event.source !== frame.contentWindow) return
    if (!isRequest(event.data)) return
    const request = event.data
    void invoke(input.context(), request.method, request.params).then(
      (result) => post({ type: Widget.BRIDGE.response, id: request.id, ok: true, result: toTransferable(result) }),
      (error: unknown) =>
        post({
          type: Widget.BRIDGE.response,
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  }

  window.addEventListener("message", onMessage)
  return {
    dispose() {
      window.removeEventListener("message", onMessage)
    },
    publish(name: string, payload: unknown) {
      post({ type: Widget.BRIDGE.event, name, payload: toTransferable(payload) })
    },
  }
}
