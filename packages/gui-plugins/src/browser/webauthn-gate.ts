import { Option, Schema } from "effect"
import type { Cdp } from "./cdp"

// Electron draws no WebAuthn request UI. On macOS and Linux, Chromium's request then waits for a dialog that never
// comes: `navigator.credentials.get` and `create` hang until their timeout, and Google's security-key step shows
// nothing. On Windows, Chromium hands the request to the system's WebAuthn API, which draws its own Windows Security
// dialog. Pages also hear that conditional (autofill) requests work, which needs Chrome's autofill UI that Electron
// lacks. This wrapper asks the pane about each explicit request through a CDP binding: the pane lets it reach Chromium
// only where the system can answer it, and refuses it at once otherwise with the `NotAllowedError` a browser gives when
// no authenticator is available, so sites offer their other sign-in methods. A page that works around the wrapper
// only gets the old hang.

const BINDING = "openCodeWebAuthn"

/** What a refused request says to the page, and to an agent that ran it. */
export const PASSKEY_REFUSAL =
  "Passkeys and security keys are not supported in this browser yet. Use another sign-in method, or sign in with your own browser and import the sign-in."

const Ask = Schema.fromJsonString(
  Schema.Struct({ id: Schema.Int.check(Schema.isGreaterThan(0)), kind: Schema.Literals(["get", "create"]) }),
)

const decodeAsk = Schema.decodeUnknownOption(Ask)

/**
 * The page-side wrapper. `answer` is the name of the function through which the pane lets a held request through
 * (true) or refuses it (false). `native` says that the system answers requests itself, as on Windows: the page then
 * keeps Chromium's own answer about a platform authenticator. Either way conditional requests stay pending until the
 * page aborts them, as when the person never picks a passkey, immediate ones fail at once as when none is available,
 * and pages hear that neither kind is available.
 */
export function webAuthnGateScript(answer: string, native: boolean) {
  return `(() => {
  const proto = globalThis.CredentialsContainer && CredentialsContainer.prototype
  const credential = globalThis.PublicKeyCredential
  if (!proto || Object.getOwnPropertyDescriptor(globalThis, ${JSON.stringify(answer)})) return
  const original = { get: proto.get, create: proto.create }
  const waiting = new Map()
  let next = 0
  Object.defineProperty(globalThis, ${JSON.stringify(answer)}, {
    value: (id, allowed) => {
      const resolve = waiting.get(id)
      waiting.delete(id)
      if (resolve) resolve(allowed === true)
    },
  })
  const stopped = (signal) => signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
  const wrap = (kind) => function (options) {
    if (!options || typeof options !== "object" || !options.publicKey) return original[kind].call(this, options)
    const signal = options.signal
    if (signal && signal.aborted) return Promise.reject(stopped(signal))
    if (kind === "get" && options.mediation === "conditional")
      return new Promise((_, reject) => signal && signal.addEventListener("abort", () => reject(stopped(signal)), { once: true }))
    if (kind === "get" && options.mediation === "immediate")
      return Promise.reject(new DOMException("No passkey is available here.", "NotAllowedError"))
    const gate = globalThis[${JSON.stringify(BINDING)}]
    return new Promise((resolve) => {
      if (typeof gate !== "function") return resolve(false)
      const id = ++next
      waiting.set(id, resolve)
      gate(JSON.stringify({ id, kind }))
    }).then((allowed) => {
      if (allowed) return original[kind].call(this, options)
      console.warn("navigator.credentials." + kind + ": " + ${JSON.stringify(PASSKEY_REFUSAL)})
      return Promise.reject(new DOMException(${JSON.stringify(PASSKEY_REFUSAL)}, "NotAllowedError"))
    })
  }
  for (const kind of ["get", "create"])
    Object.defineProperty(proto, kind, { value: wrap(kind), writable: true, configurable: true, enumerable: true })
  if (!credential) return
  const define = (name, value) => Object.defineProperty(credential, name, { value, writable: true, configurable: true })
  define("isConditionalMediationAvailable", () => Promise.resolve(false))
  if (!${native}) define("isUserVerifyingPlatformAuthenticatorAvailable", () => Promise.resolve(false))
  const capabilities = credential.getClientCapabilities
  if (typeof capabilities !== "function") return
  const unavailable = ["conditionalGet", "conditionalCreate", "immediateGet", ...(${native} ? [] : ["hybridTransport", "passkeyPlatformAuthenticator", "userVerifyingPlatformAuthenticator"])]
  define("getClientCapabilities", () =>
    capabilities.call(credential).then((found) => ({ ...found, ...Object.fromEntries(unavailable.map((name) => [name, false])) })),
  )
})()`
}

/** Why an agent command stopped: the page it drove asked for a passkey or security key, which was refused. */
export function agentPasskeyRefusal(url: string) {
  const host = URL.parse(url)?.host || "The page"

  return `${host} asked for a passkey or security key (WebAuthn). The desktop browser refused it at once with NotAllowedError: agent tools cannot complete a passkey or security-key sign-in. The site may now offer another sign-in method; otherwise ask the user to sign in with their own browser and import the sign-in (Settings > Browser > Import sign-ins). Then continue with browser.snapshot({tabID}).`
}

/**
 * Installs the wrapper in a tab's frames. `allow` decides each explicit request: true lets it reach Chromium, which
 * only `native` systems answer. `refused` runs for each request the pane refused. `attach` installs it in the page's
 * own session or in an out-of-process frame's.
 */
export function guardWebAuthn(cdp: Cdp, input: { native: boolean; allow: () => boolean; refused: () => void }) {
  const answer = `openCodeWebAuthnAnswer${crypto.randomUUID().replaceAll("-", "")}`

  const off = cdp.on("Runtime.bindingCalled", (event, sessionID) => {
    if (event.name !== BINDING || event.payload.length > 256) return
    const ask = Option.getOrUndefined(decodeAsk(event.payload))

    if (!ask) return
    const allowed = input.native && input.allow()

    if (!allowed) input.refused()
    void cdp
      .send(
        "Runtime.evaluate",
        { expression: `globalThis[${JSON.stringify(answer)}]?.(${ask.id}, ${allowed})`, contextId: event.executionContextId },
        sessionID,
      )
      .catch(() => undefined)
  })

  return {
    attach: (sessionID?: string) =>
      Promise.all([
        cdp.send("Runtime.addBinding", { name: BINDING }, sessionID),
        cdp.send(
          "Page.addScriptToEvaluateOnNewDocument",
          { source: webAuthnGateScript(answer, input.native), runImmediately: true },
          sessionID,
        ),
      ]).then(() => undefined),
    dispose: off,
  }
}
