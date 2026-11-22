import { expect, test } from "bun:test"
import type { SessionRef } from "@opencode/plugin/gui"
import { attachable } from "./prompt-gate"

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
