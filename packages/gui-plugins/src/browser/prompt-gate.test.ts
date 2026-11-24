import { expect, test } from "bun:test"
import type { SessionRef } from "@opencode/plugin/gui"
import { attachable, attachesUnopened } from "./prompt-gate"

// SAFETY: `attachable` reads only these fields of a session and its server.
const session = (server: { connected?: boolean; compatible?: boolean; local?: boolean }, located = true) =>
  ({
    location: located ? { directory: "/repo" } : undefined,
    server: { connected: true, compatible: true, local: false, ...server },
  }) as SessionRef

test.each([
  ["a connected, compatible server and a located session", session({}), true, true],
  ["a server that is not connected, or is reconnecting", session({ connected: false }), true, false],
  ["a server this app cannot talk to", session({ compatible: false }), true, false],
  ["a session with no location yet", session({}, false), true, false],
  ["a window that is offline, with the server on another computer", session({}), false, false],
  ["a window that is offline, with the server on this computer", session({ local: true }), false, true],
] as const)("a prompt can gain from waiting for the attachment only with %s", (_label, ref, online, expected) => {
  expect(attachable(ref, online)).toBe(expected)
})

const grant = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
]

// SAFETY: `attachesUnopened` reads only these fields of a session, its server and that server's session data.
const tab = (input: { running?: boolean; connected?: boolean; rules?: { action: string; resource: string; effect: string }[] }) =>
  ({
    id: "ses_tab",
    location: { directory: "/repo" },
    server: {
      connected: input.connected ?? true,
      compatible: true,
      local: true,
      data: {
        session: {
          status: (id: string) => (id === "ses_tab" && (input.running ?? true) ? "running" : "idle"),
          get: (id: string) => (id === "ses_tab" ? { permissions: input.rules } : undefined),
        },
      },
    },
  }) as SessionRef

test.each([
  ["runs and no desktop has attached to it", tab({}), true],
  ["runs under rules that do not grant the browser", tab({ rules: [{ action: "browser", resource: "*", effect: "deny" }] }), true],
  ["is idle", tab({ running: false }), false],
  ["runs and already holds a pane's browser grant", tab({ rules: grant }), false],
  ["runs on a server that is not connected", tab({ connected: false }), false],
] as const)("a session in a tab nobody opened attaches only while it runs without a pane: it %s", (_label, ref, expected) => {
  expect(attachesUnopened(ref, true)).toBe(expected)
})
