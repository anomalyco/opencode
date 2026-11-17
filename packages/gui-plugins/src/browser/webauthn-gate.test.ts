import { expect, test } from "bun:test"
import type { Cdp } from "./cdp"
import { afterRefusal, agentPasskeyRefusal, guardWebAuthn, type PasskeyAsker } from "./webauthn-gate"

/** The parts of CDP events the gate reads. */
type CdpEvent = {
  readonly frame?: { readonly id: string }
  readonly context?: { readonly id: number; readonly origin: string; readonly auxData: { readonly frameId: string; readonly isDefault: boolean } }
  readonly name?: string
  readonly payload?: string
  readonly executionContextId?: number
}

// The page's side and the browser process run in the pinned Electron (electron-webauthn.test.ts), which never lets a
// request reach the system, so no system dialog opens. This drives the pane's decision at the CDP boundary, where
// letting a request through is only a reply.
async function gate(native: boolean, enable: () => Promise<object> = async () => ({})) {
  const sent: { method: string; params: { name?: string; expression?: string } }[] = []
  const listeners = new Map<string, ((event: CdpEvent, sessionID?: string) => void)[]>()
  const asked: PasskeyAsker[] = []

  const cdp = {
    on: (method: string, callback: (event: CdpEvent, sessionID?: string) => void) => {
      listeners.set(method, [...(listeners.get(method) ?? []), callback])

      return () => undefined
    },
    send: async (method: string, params: { name?: string; expression?: string } = {}) => {
      sent.push({ method, params })

      return method === "WebAuthn.enable" ? enable() : {}
    },
  }

  // SAFETY: the gate uses only `on` and `send`, which the object above implements with CDP's shapes.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const guard = guardWebAuthn(cdp as unknown as Cdp, { native, refused: (asker) => asked.push(asker) })
  await guard.attach()
  const report = sent.find((item) => item.method === "Runtime.addBinding")?.params.name ?? ""
  const emit = (method: string, event: CdpEvent, sessionID?: string) => listeners.get(method)?.forEach((listener) => listener(event, sessionID))

  emit("Page.frameNavigated", { frame: { id: "top" } })
  emit("Runtime.executionContextCreated", { context: { id: 1, origin: "https://site.test", auxData: { frameId: "top", isDefault: true } } })
  emit("Runtime.executionContextCreated", { context: { id: 2, origin: "https://ads.test", auxData: { frameId: "ad", isDefault: true } } }, "frame")

  const call = (payload: string, context = 1, sessionID?: string, name = report) =>
    emit("Runtime.bindingCalled", { name, payload, executionContextId: context }, sessionID)

  const replies = () =>
    sent.flatMap((item) => (item.method === "Runtime.evaluate" ? [item.params.expression?.match(/detail: \[(\d+), (true|false)\]/)?.slice(1)] : []))

  return { guard, sent, call, replies, asked, report }
}

test("lets a request reach the system only until the tab must refuse, which the browser process then enforces", async () => {
  const windows = await gate(true)
  windows.call(JSON.stringify({ id: 1, kind: "get" }))
  expect(windows.replies()).toEqual([["1", "true"]])
  expect(windows.asked).toEqual([])
  expect(windows.sent.some((item) => item.method === "WebAuthn.enable")).toBe(false)

  // The agent drives the tab: the environment turns on once, and every later request is refused.
  await Promise.all([windows.guard.enforce(), windows.guard.enforce()])
  windows.call(JSON.stringify({ id: 2, kind: "create" }))
  expect(windows.replies()).toEqual([["1", "true"], ["2", "false"]])
  expect(windows.sent.filter((item) => item.method === "WebAuthn.enable")).toHaveLength(1)
  expect(windows.asked).toEqual([{ origin: "https://site.test", mainFrame: true }])

  // macOS and Linux refuse from the start; the page refuses on its own, so the pane only hears who asked.
  const mac = await gate(false)
  mac.call(JSON.stringify({ id: 1, kind: "get" }), 2, "frame")
  expect(mac.replies()).toEqual([])
  expect(mac.asked).toEqual([{ origin: "https://ads.test", mainFrame: false }])
  expect(mac.guard.enforced()).toBe(true)
})

test("ignores calls that are not the gate's own, and leaves no fixed name for a page to find", async () => {
  const page = await gate(false)
  const other = await gate(false)
  expect(page.report).not.toBe(other.report)
  expect(page.report).not.toMatch(/opencode|webauthn/i)
  page.call(JSON.stringify({ id: 1, kind: "get" }), 1, undefined, "openCodeWebAuthn")
  page.call(JSON.stringify({ id: 0, kind: "get" }))
  page.call(JSON.stringify({ id: 1, kind: "sign" }))
  page.call(`{"id":1,"kind":"get","pad":"${"x".repeat(300)}"}`)
  page.call("not json")
  expect(page.asked).toEqual([])
})

test("tells an agent which site asked, and what to do instead", () => {
  expect(agentPasskeyRefusal("accounts.google.com")).toStartWith("accounts.google.com asked for a passkey or security key (WebAuthn).")
  expect(agentPasskeyRefusal(undefined)).toStartWith("The page asked")
})

test("an agent's action starts only once Chromium turned the refusal on, and never if it could not", async () => {
  const answer = Promise.withResolvers<object>()
  const tab = await gate(true, () => answer.promise)
  const order: string[] = []

  const run = afterRefusal(tab.guard.enforce, Promise.resolve(), () => order.push("action"))
  await Bun.sleep(0)
  expect(tab.sent.filter((item) => item.method === "WebAuthn.enable")).toHaveLength(1)
  expect(order).toEqual([])
  order.push("enabled")
  answer.resolve({})
  await run
  expect(order).toEqual(["enabled", "action"])

  // A failed command stops the action, and the next one sends it again.
  const failing = await gate(true, () => Promise.reject(new Error("WebAuthn.enable failed")))
  const action = { ran: false }
  await expect(afterRefusal(failing.guard.enforce, Promise.resolve(), () => (action.ran = true))).rejects.toThrow("WebAuthn.enable failed")
  expect(action.ran).toBe(false)
  await failing.guard.enforce().catch(() => undefined)
  expect(failing.sent.filter((item) => item.method === "WebAuthn.enable")).toHaveLength(2)
  // The page-side refusal holds meanwhile.
  expect(failing.guard.enforced()).toBe(true)

  // The person's command waits for nothing of the kind.
  const person = await gate(true, () => new Promise(() => undefined))
  expect(await afterRefusal(undefined, Promise.resolve(), () => "ran")).toBe("ran")
  expect(person.sent.some((item) => item.method === "WebAuthn.enable")).toBe(false)
})