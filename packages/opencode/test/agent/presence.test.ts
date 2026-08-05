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

  test("maps loop stalls independently of provider health", () => {
    expect(
      AgentPresence.statusFrom({
        session: { type: "busy" },
        permissionPending: false,
        loop: {
          id: "loop_01J00000000000000000000000" as NonNullable<AgentPresence.Info["loopID"]>,
          directory: "/repo",
          sessionID: "ses_01J00000000000000000000000" as AgentPresence.Info["sessionID"],
          prompt: "redacted",
          status: "stalled",
          maxIterations: 10,
          noProgressLimit: 3,
          completionToken: "<promise>COMPLETE</promise>",
          iteration: 7,
          iterations: [],
          startedAt: Date.now(),
        },
      }),
    ).toBe("stalled")
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
