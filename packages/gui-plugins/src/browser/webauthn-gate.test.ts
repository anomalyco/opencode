import { expect, test } from "bun:test"
import type { Cdp } from "./cdp"
import { agentPasskeyRefusal, guardWebAuthn } from "./webauthn-gate"

// The page's side runs in the pinned Electron (electron-webauthn.test.ts), which never lets a request through, so no
// system dialog opens. This drives the pane's decision at the CDP boundary, where letting one through is only a reply.
function gate(native: boolean, allow: boolean) {
  const sent: { method: string; expression?: string }[] = []
  const listeners: ((event: { name: string; payload: string; executionContextId: number }) => void)[] = []
  const refusals = { count: 0 }

  const cdp = {
    on: (_method: string, callback: (typeof listeners)[number]) => {
      listeners.push(callback)

      return () => undefined
    },
    send: async (method: string, params: { expression?: string } = {}) => {
      sent.push({ method, expression: params.expression })

      return {}
    },
  }

  // SAFETY: the gate uses only `on("Runtime.bindingCalled")` and `send`, which the object above implements.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  guardWebAuthn(cdp as unknown as Cdp, { native, allow: () => allow, refused: () => refusals.count++ })

  const call = (payload: string, name = "openCodeWebAuthn") =>
    listeners.forEach((listener) => listener({ name, payload, executionContextId: 7 }))

  const answers = () =>
    sent.flatMap((item) => (item.method === "Runtime.evaluate" ? [item.expression?.match(/\((\d+), (true|false)\)$/)?.slice(1)] : []))

  return { call, answers, refusals }
}

test("lets a request reach the system only where it answers and the pane allows it", () => {
  const windows = gate(true, true)
  windows.call(JSON.stringify({ id: 1, kind: "get" }))
  expect(windows.answers()).toEqual([["1", "true"]])
  expect(windows.refusals.count).toBe(0)

  // An agent-driven tab on Windows, and every tab where the system shows no dialog, refuse at once.
  const agent = gate(true, false)
  const mac = gate(false, true)
  agent.call(JSON.stringify({ id: 2, kind: "create" }))
  mac.call(JSON.stringify({ id: 3, kind: "get" }))
  expect([agent.answers(), mac.answers()]).toEqual([[["2", "false"]], [["3", "false"]]])
  expect([agent.refusals.count, mac.refusals.count]).toEqual([1, 1])
})

test("ignores calls that are not the gate's own", () => {
  const page = gate(false, false)
  page.call(JSON.stringify({ id: 1, kind: "get" }), "somethingElse")
  page.call(JSON.stringify({ id: 0, kind: "get" }))
  page.call(JSON.stringify({ id: 1, kind: "sign" }))
  page.call(`{"id":1,"kind":"get","pad":"${"x".repeat(300)}"}`)
  page.call("not json")
  expect(page.answers()).toEqual([])
  expect(page.refusals.count).toBe(0)
})

test("tells an agent which site asked, and what to do instead", () => {
  expect(agentPasskeyRefusal("https://accounts.google.com/v3/signin/challenge/pk")).toStartWith(
    "accounts.google.com asked for a passkey or security key (WebAuthn).",
  )
  expect(agentPasskeyRefusal("about:blank")).toStartWith("The page asked")
})
