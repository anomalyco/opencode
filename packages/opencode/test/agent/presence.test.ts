import { describe, expect, test } from "bun:test"
import * as AgentPresence from "../../src/agent/presence"

describe("Agent presence", () => {
  test("maps pending permission ahead of busy session state", () => {
    expect(
      AgentPresence.statusFrom({
        session: { type: "busy" },
        permissionPending: true,
      }),
    ).toBe("awaiting-permission")
  })

  // The derivation takes the loop structurally (`{ status }`) rather than a
  // whole Loop.Info: it lives in a leaf module so `session/peers.ts` can use it
  // without closing an import cycle through the loop service.
  test("maps loop stalls independently of provider health", () => {
    expect(
      AgentPresence.statusFrom({
        session: { type: "busy" },
        permissionPending: false,
        loop: { status: "stalled" },
      }),
    ).toBe("stalled")
  })

  test("a cancelled loop reads as cancelling, not busy", () => {
    expect(
      AgentPresence.statusFrom({
        session: { type: "busy" },
        permissionPending: false,
        loop: { status: "cancelled" },
      }),
    ).toBe("cancelling")
  })

  test("idle sessions are not active unless they own a paused loop", () => {
    const base = {
      owner: "opencode-skein" as const,
      instanceID: "test",
      sessionID: "ses_01J00000000000000000000000" as AgentPresence.Info["sessionID"],
      directory: "/repo",
      status: "idle" as const,
      lastEventAt: Date.now(),
      heartbeatAt: Date.now(),
      canPrompt: true,
      canBtw: true,
      canAbort: false,
    }
    expect(AgentPresence.isActive(base)).toBe(false)
    expect(AgentPresence.isActive({ ...base, loopStatus: "paused" })).toBe(true)
  })
})
