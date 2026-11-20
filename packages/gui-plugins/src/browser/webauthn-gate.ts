import { Option, Schema } from "effect"
import type { Cdp } from "./cdp"

// Electron draws no WebAuthn request UI. On macOS and Linux, Chromium's request then waits for a dialog that never
// comes: `navigator.credentials.get` and `create` hang until their timeout, and Google's security-key step shows
// nothing. On Windows, Chromium hands the request to the system's WebAuthn API, which draws its own Windows Security
// dialog.
//
// Where the pane refuses passkeys (always on macOS and Linux; on Windows in tabs the agent drives and in tabs that can
// script one), `enforce` turns on CDP's virtual authenticator environment for the tab, with no authenticator: Chromium
// then answers every WebAuthn request of the tab's frame tree itself, out-of-process frames included, and never asks
// the system, whatever the page's script does. The page-side wrapper is only the fast path: it refuses at once with the
// `NotAllowedError` a browser gives when no authenticator is available, so sites offer their other sign-in methods,
// and lets the pane say why. A request that gets around it waits for its own timeout in the empty environment.

/** What a refused request says to the page, and to an agent that ran it. */
export const PASSKEY_REFUSAL =
  "Passkeys and security keys are not supported in this browser yet. Use another sign-in method, or sign in with your own browser and import the sign-in."

const Ask = Schema.fromJsonString(
  Schema.Struct({ id: Schema.Int.check(Schema.isGreaterThan(0)), kind: Schema.Literals(["get", "create"]) }),
)

const decodeAsk = Schema.decodeUnknownOption(Ask)

/**
 * The page-side wrapper. `report` is the CDP binding it asks through, which it takes and removes from the page before
 * any page script runs; `answer` is the event the pane answers with. Both names are random, so a page can neither find
 * nor guess them. `native` says that the system answers requests itself, as on Windows: the wrapper then waits for the
 * pane, and the page keeps Chromium's own answer about a platform authenticator. Either way conditional requests stay
 * pending until the page aborts them, as when the person never picks a passkey, immediate ones fail at once as when
 * none is available, and pages hear that neither kind is available.
 *
 * Each option the decision reads is read once and handed on fixed, over the page's own object, so a getter cannot
 * answer the wrapper one way and Chromium another. The wrapped functions are proxies of the originals, which keep their
 * names and lengths.
 */
export function webAuthnGateScript(report: string, answer: string, native: boolean) {
  return `(() => {
  const ask = globalThis[${JSON.stringify(report)}]
  if (typeof ask !== "function") return
  delete globalThis[${JSON.stringify(report)}]
  const proto = globalThis.CredentialsContainer && CredentialsContainer.prototype
  const credential = globalThis.PublicKeyCredential
  if (!proto) return
  const apply = Reflect.apply
  const listen = EventTarget.prototype.addEventListener
  const warn = console.warn
  const waiting = new Map()
  let next = 0
  apply(listen, globalThis, [${JSON.stringify(answer)}, (event) => {
    const reply = event.detail
    const resolve = Array.isArray(reply) && waiting.get(reply[0])
    if (!resolve) return
    waiting.delete(reply[0])
    resolve(reply[1] === true)
  }])
  const refused = () => new DOMException(${JSON.stringify(PASSKEY_REFUSAL)}, "NotAllowedError")
  const stopped = (signal) => signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
  const request = (kind, target, self, args) => {
    const options = args[0]
    if (options === null || (typeof options !== "object" && typeof options !== "function")) return apply(target, self, args)
    let publicKey, mediation, signal
    try {
      publicKey = options.publicKey
      mediation = options.mediation
      signal = options.signal
    } catch (error) {
      return Promise.reject(error)
    }
    const fixed = Object.create(options, {
      publicKey: { value: publicKey, enumerable: true },
      mediation: { value: mediation, enumerable: true },
      signal: { value: signal, enumerable: true },
    })
    const call = () => apply(target, self, [fixed, ...args.slice(1)])
    if (!publicKey) return call()
    const abortable = signal instanceof AbortSignal
    if (abortable && signal.aborted) return Promise.reject(stopped(signal))
    if (kind === "get" && mediation === "conditional")
      return new Promise((_, reject) => abortable && signal.addEventListener("abort", () => reject(stopped(signal)), { once: true }))
    if (kind === "get" && mediation === "immediate") return Promise.reject(new DOMException("No passkey is available here.", "NotAllowedError"))
    const id = ++next
    const decided = ${native} ? new Promise((resolve) => waiting.set(id, resolve)) : Promise.resolve(false)
    ask(JSON.stringify({ id, kind }))
    return decided.then((allowed) => {
      if (allowed) return call()
      apply(warn, console, ["navigator.credentials." + kind + ": " + ${JSON.stringify(PASSKEY_REFUSAL)}])
      return Promise.reject(refused())
    })
  }
  const wrap = (kind) => new Proxy(proto[kind], { apply: (target, self, args) => request(kind, target, self, args) })
  for (const kind of ["get", "create"])
    Object.defineProperty(proto, kind, { value: wrap(kind), writable: true, configurable: true, enumerable: true })
  if (!credential) return
  const answerWith = (name, run) => {
    const original = credential[name]
    if (typeof original === "function")
      Object.defineProperty(credential, name, { value: new Proxy(original, { apply: (target, self, args) => run(target, self, args) }), writable: true, configurable: true })
  }
  answerWith("isConditionalMediationAvailable", () => Promise.resolve(false))
  if (!${native}) answerWith("isUserVerifyingPlatformAuthenticatorAvailable", () => Promise.resolve(false))
  const unavailable = ["conditionalGet", "conditionalCreate", "immediateGet", ...(${native} ? [] : ["hybridTransport", "passkeyPlatformAuthenticator", "userVerifyingPlatformAuthenticator"])]
  answerWith("getClientCapabilities", (target, self, args) =>
    apply(target, self, args).then((found) => ({ ...found, ...Object.fromEntries(unavailable.map((name) => [name, false])) })),
  )
})()`
}

/** Why an agent command stopped: the page it drove asked for a passkey or security key, which was refused. */
export function agentPasskeyRefusal(site: string | undefined) {
  return `${site || "The page"} asked for a passkey or security key (WebAuthn). The desktop browser refused it at once with NotAllowedError: agent tools cannot complete a passkey or security-key sign-in. The site may now offer another sign-in method; otherwise ask the user to sign in with their own browser and import the sign-in (Settings > Browser > Import sign-ins). Then continue with browser.snapshot({tabID}).`
}

/**
 * Who asked: the execution context's origin, and whether it is the tab's main frame. Undefined origin for a context
 * the pane never saw.
 */
export type PasskeyAsker = { readonly origin: string | undefined; readonly mainFrame: boolean }

/**
 * A command's action, started once the steps it waits for are done and, for the agent's, once the tab refuses
 * passkeys in the browser process (`restrict`); if that failed, the action never starts.
 */
export function afterRefusal<T>(restrict: (() => Promise<void>) | undefined, steps: Promise<unknown>, action: () => T | Promise<T>) {
  return Promise.all([steps, restrict?.()]).then(action)
}

/**
 * Whether the tab refuses (`enforced`), the environment's command while it is sent or once it succeeded (`enabling`),
 * and the tab's main frame (`top`).
 */
type GateState = { enforced: boolean; enabling?: Promise<void>; top?: string }

/**
 * Installs the wrapper in a tab's frames, and `enforce` the refusal in the browser process. Until `enforce` runs, a
 * `native` system's dialog answers what the page asks; afterwards the pane refuses too. `refused` runs for each request
 * the pane refused, with who asked. `attach` installs the wrapper in the page's own session or in an out-of-process
 * frame's. `enforce` is idempotent and never undone: call it before the tab's first agent command, and when the tab is
 * created where it must refuse, before its first document loads. Its command is dispatched synchronously, so a pop-up
 * enforced while Electron creates it is covered before its opener's script runs again.
 */
export function guardWebAuthn(cdp: Cdp, input: { native: boolean; refused: (asker: PasskeyAsker) => void }) {
  const random = () => crypto.randomUUID().replaceAll("-", "")
  const report = `_${random()}`
  const answer = `_${random()}`
  // Each execution context's origin and frame, by session and id, so a refusal names the document that asked.
  const contexts = new Map<string, { readonly origin: string; readonly frameId?: string }>()
  const key = (sessionID: string | undefined, id: number) => `${sessionID ?? ""}\n${id}`
  const state: GateState = { enforced: !input.native }

  const offs = [
    cdp.on("Page.frameNavigated", ({ frame }, sessionID) => {
      if (!sessionID && !frame.parentId) state.top = frame.id
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
      if (event.name !== report || event.payload.length > 256) return
      const ask = Option.getOrUndefined(decodeAsk(event.payload))

      if (!ask) return
      const context = contexts.get(key(sessionID, event.executionContextId))
      const allowed = !state.enforced

      if (!allowed) input.refused({ origin: context?.origin, mainFrame: !sessionID && !!context && context.frameId === state.top })

      if (!input.native) return
      void cdp
        .send(
          "Runtime.evaluate",
          {
            expression: `EventTarget.prototype.dispatchEvent.call(globalThis, new CustomEvent(${JSON.stringify(answer)}, { detail: [${ask.id}, ${allowed}] }))`,
            contextId: event.executionContextId,
          },
          sessionID,
        )
        .catch(() => undefined)
    }),
  ]

  const enforce = () => {
    state.enforced = true
    // No authenticator is ever added: every request of the tab's frame tree then fails in Chromium.
    const enabling = state.enabling ?? cdp.send("WebAuthn.enable", { enableUI: false }).then(() => undefined)
    state.enabling = enabling
    // A failed command is sent again by the next call; the page-side refusal holds meanwhile.
    enabling.catch(() => {
      if (state.enabling === enabling) state.enabling = undefined
    })

    return enabling
  }

  return {
    attach: (sessionID?: string) =>
      Promise.all([
        cdp.send("Runtime.addBinding", { name: report }, sessionID),
        cdp.send(
          "Page.addScriptToEvaluateOnNewDocument",
          { source: webAuthnGateScript(report, answer, input.native), runImmediately: true },
          sessionID,
        ),
      ]).then(() => undefined),
    enforce,
    /** Whether the pane refuses this tab's requests. */
    enforced: () => state.enforced,
    dispose: () => offs.forEach((off) => off()),
  }
}
