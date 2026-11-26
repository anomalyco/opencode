import { Option, Schema } from "effect"
import type { Cdp } from "./cdp"
import { originOf, type PermissionKind } from "./site-permissions"

// Holds a page's getUserMedia until the pane decided it. Blink reads the capabilities of every microphone before it
// asks the browser for permission (UserMediaProcessor::SetupAudioInput), and on macOS reading them opens the device,
// which makes the system ask whether OpenCode may use it: the system's prompt would come before the site's bar. The
// page's call therefore asks the pane first, through a CDP binding, and reaches Blink only once the pane lets it.
// A page that works around the wrapper only gets the old order: the site's own request still needs the user's Allow.

const BINDING = "openCodeMediaGate"

const Ask = Schema.fromJsonString(
  Schema.Struct({ id: Schema.Int.check(Schema.isGreaterThan(0)), audio: Schema.Boolean, video: Schema.Boolean }),
)

const decodeAsk = Schema.decodeUnknownOption(Ask)

/** A held call, as the pane decides it: who asks and for which devices. */
export type MediaAsk = {
  readonly origin: string
  readonly mainFrame: boolean
  readonly kinds: readonly PermissionKind[]
}

/**
 * The page-side wrapper. `answer` is the name of the function through which the pane releases (true) or refuses
 * (false) a held call; the call then runs the original getUserMedia, or rejects as a refused permission does.
 */
export function mediaGateScript(answer: string) {
  return `(() => {
  const proto = globalThis.MediaDevices && MediaDevices.prototype
  if (!proto || Object.getOwnPropertyDescriptor(globalThis, ${JSON.stringify(answer)})) return
  const original = proto.getUserMedia
  const waiting = new Map()
  let next = 0
  Object.defineProperty(globalThis, ${JSON.stringify(answer)}, {
    value: (id, allowed) => {
      const resolve = waiting.get(id)
      waiting.delete(id)
      if (resolve) resolve(allowed === true)
    },
  })
  const getUserMedia = function getUserMedia(constraints) {
    const audio = !!(constraints && constraints.audio)
    const video = !!(constraints && constraints.video)
    const gate = globalThis[${JSON.stringify(BINDING)}]
    if ((!audio && !video) || typeof gate !== "function") return original.call(this, constraints)
    return new Promise((resolve) => {
      const id = ++next
      waiting.set(id, resolve)
      gate(JSON.stringify({ id, audio, video }))
    }).then((allowed) =>
      allowed ? original.call(this, constraints) : Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
    )
  }
  Object.defineProperty(proto, "getUserMedia", { value: getUserMedia, writable: true, configurable: true, enumerable: true })
  for (const name of ["getUserMedia", "webkitGetUserMedia"]) {
    if (typeof Navigator.prototype[name] !== "function") continue
    const legacy = function (constraints, success, failure) {
      navigator.mediaDevices.getUserMedia(constraints).then(success, failure)
    }
    Object.defineProperty(Navigator.prototype, name, { value: legacy, writable: true, configurable: true, enumerable: true })
  }
})()`
}

/**
 * Installs the wrapper in a tab's frames and answers its held calls with `decide`. `attach` installs it in the page's
 * own session or in an out-of-process frame's.
 */
export function guardMediaRequests(cdp: Cdp, decide: (ask: MediaAsk) => Promise<boolean>) {
  const answer = `openCodeMediaAnswer${crypto.randomUUID().replaceAll("-", "")}`
  // Each execution context's origin and frame, by session and id, so a held call is decided for its real document.
  const contexts = new Map<string, { readonly origin: string; readonly frameId?: string }>()
  const key = (sessionID: string | undefined, id: number) => `${sessionID ?? ""}\n${id}`
  let top: string | undefined

  const offs = [
    cdp.on("Page.frameNavigated", ({ frame }, sessionID) => {
      if (!sessionID && !frame.parentId) top = frame.id
    }),
    cdp.on("Runtime.executionContextCreated", ({ context }, sessionID) => {
      // SAFETY: CDP documents a page execution context's auxData as `{ frameId, isDefault, type }`.
      const aux = context.auxData as { frameId?: string; isDefault?: boolean } | undefined

      if (aux?.isDefault) contexts.set(key(sessionID, context.id), { origin: context.origin, frameId: aux.frameId })
    }),
    cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }, sessionID) =>
      contexts.delete(key(sessionID, executionContextId)),
    ),
    cdp.on("Runtime.executionContextsCleared", (_event, sessionID) =>
      contexts.forEach((_context, id) => {
        if (id.startsWith(`${sessionID ?? ""}\n`)) contexts.delete(id)
      }),
    ),
    cdp.on("Runtime.bindingCalled", (event, sessionID) => {
      if (event.name !== BINDING || event.payload.length > 256) return
      const ask = Option.getOrUndefined(decodeAsk(event.payload))

      if (!ask) return
      const context = contexts.get(key(sessionID, event.executionContextId))
      const kinds = [...(ask.video ? ["camera" as const] : []), ...(ask.audio ? ["microphone" as const] : [])]

      // A call from a context the pane never saw is refused: its document is unknown.
      const decided = context
        ? decide({ origin: originOf(context.origin), mainFrame: !sessionID && context.frameId === top, kinds })
        : Promise.resolve(false)

      void decided
        .catch(() => false)
        .then((allowed) =>
          cdp.send(
            "Runtime.evaluate",
            { expression: `globalThis[${JSON.stringify(answer)}]?.(${ask.id}, ${allowed})`, contextId: event.executionContextId },
            sessionID,
          ),
        )
        .catch(() => undefined)
    }),
  ]

  return {
    attach: (sessionID?: string) =>
      Promise.all([
        cdp.send("Runtime.addBinding", { name: BINDING }, sessionID),
        cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: mediaGateScript(answer), runImmediately: true }, sessionID),
      ]).then(() => undefined),
    dispose: () => offs.forEach((off) => off()),
  }
}
