import { describe, expect, test } from "bun:test"
import { SessionID } from "@/session/schema"
import {
  gateToolCall,
  gateSpawn,
  finishStep,
  resetSession,
  seedFromPressure,
  blockedOutput,
  policy,
  readState,
} from "@/ace"
import { actionFor, resolve } from "@/ace/policy"
import { ablate, ablationConfig, experimentArm, formatReplayStatus, reduceReplayEvent } from "@/ace/replay"

const sessionID = SessionID.make("ses_ace_test_001")

describe("ACE policy", () => {
  test("defaults to disabled when ace config is absent", () => {
    expect(resolve(undefined).enabled).toBe(false)
  })

  test("defaults to fixed-cap when ace block is present", () => {
    expect(resolve({}).mode).toBe("fixed-cap")
    expect(resolve({}).enabled).toBe(true)
  })

  test("maps legacy cap/reject aliases", () => {
    expect(resolve({ mode: "cap" }).mode).toBe("fixed-cap")
    expect(resolve({ mode: "reject" }).mode).toBe("reject-escalate")
  })

  test("fallback modes map to actions", () => {
    const base = resolve({ mode: "monitor", maxSteps: 1 })
    expect(actionFor(base, true)).toBe("observe")
    expect(actionFor(resolve({ mode: "fixed-cap", maxSteps: 1 }), true)).toBe("block")
    expect(actionFor(resolve({ mode: "reject-escalate", maxSteps: 1 }), true)).toBe("escalate")
  })
})

describe("ACE gates", () => {
  test("monitor mode observes but does not block tool calls", () => {
    resetSession(sessionID)
    const config = { mode: "monitor" as const, maxSteps: 1 }
    const first = gateToolCall(config, { sessionID, tool: "read" })
    expect(first?.action).toBe("allow")
    const second = gateToolCall(config, { sessionID, tool: "read" })
    expect(second?.action).toBe("observe")
    expect(second?.wouldBlock).toBe(true)
    expect(blockedOutput(second!)).toContain("ACE")
    resetSession(sessionID)
  })

  test("fixed-cap blocks tool calls over session limit", () => {
    resetSession(sessionID)
    const config = { mode: "fixed-cap" as const, maxSteps: 1 }
    gateToolCall(config, { sessionID, tool: "read" })
    const blocked = gateToolCall(config, { sessionID, tool: "read" })
    expect(blocked?.action).toBe("block")
    resetSession(sessionID)
  })

  test("tracks spawn depth limits", () => {
    resetSession(sessionID)
    const config = {
      mode: "fixed-cap" as const,
      maxSpawns: 10,
      limits: { spawnDepth: 1, parallelSubagents: 10 },
    }
    const ok = gateSpawn(config, { sessionID, subagent: "explore", depth: 1 })
    expect(ok?.action).toBe("allow")
    const depthBlocked = gateSpawn(config, { sessionID, subagent: "explore", depth: 2 })
    expect(depthBlocked?.action).toBe("block")
    resetSession(sessionID)
  })

  test("finishStep resets turn counters", () => {
    resetSession(sessionID)
    gateToolCall({ mode: "fixed-cap" as const, limits: { toolCallsPerTurn: 1 } }, { sessionID, tool: "read" })
    const pressure = finishStep(sessionID)
    expect(pressure.turnToolCalls).toBe(1)
    expect(readState(sessionID)?.turnToolCalls).toBe(0)
    resetSession(sessionID)
  })

  test("seedFromPressure restores replay snapshot", () => {
    resetSession(sessionID)
    seedFromPressure(sessionID, {
      toolCalls: 7,
      turnToolCalls: 2,
      spawns: 3,
      spawnDepth: 1,
      activeSubagents: 1,
      windowMs: 1000,
    })
    const next = gateToolCall({ mode: "fixed-cap", maxSteps: 5 }, { sessionID, tool: "read" })
    expect(next?.pressure.toolCalls).toBe(8)
    resetSession(sessionID)
  })
})

describe("ACE ablation", () => {
  test("ablationConfig overrides mode by arm", () => {
    expect(ablationConfig({ mode: "fixed-cap" }, "monitor-only")?.mode).toBe("monitor")
    expect(ablationConfig({ mode: "fixed-cap" }, "no-ace")?.enabled).toBe(false)
  })

  test("experimentArm reads config experiment", () => {
    expect(experimentArm({ experiment: { arm: "fixed-cap" } })).toBe("fixed-cap")
  })

  test("ablate compares policy arms from persisted tool events", () => {
    const summaries = ablate({
      events: [
        {
          aggregateID: sessionID,
          seq: 1,
          type: "session.next.tool.called",
          data: { tool: "read", callID: "call_1", input: {} },
        },
        {
          aggregateID: sessionID,
          seq: 2,
          type: "session.next.tool.called",
          data: { tool: "read", callID: "call_2", input: {} },
        },
      ],
      policies: [
        { name: "monitor", ace: { enabled: true, mode: "monitor", maxSteps: 1 } },
        { name: "cap", ace: { enabled: true, mode: "fixed-cap", maxSteps: 1 } },
      ],
    })
    expect(summaries[0]?.observed).toBe(1)
    expect(summaries[1]?.blocked).toBe(1)
  })
})

describe("ACE replay reducer", () => {
  test("reduceReplayEvent updates footer state", () => {
    const state = { mode: "off" as const, toolCalls: 0, spawns: 0, activeSubagents: 0 }
    const next = reduceReplayEvent(
      {
        type: "session.next.ace.pressure",
        properties: {
          sessionID,
          mode: "monitor",
          pressure: {
            toolCalls: 4,
            turnToolCalls: 1,
            spawns: 2,
            spawnDepth: 1,
            activeSubagents: 1,
            windowMs: 500,
          },
        },
      },
      sessionID,
      state,
    )
    expect(next?.toolCalls).toBe(4)
    expect(formatReplayStatus(next!)).toBe("ACE monitor 4tc 2sp 1active")
  })
})

describe("ACE policy helper", () => {
  test("policy() mirrors resolve()", () => {
    expect(policy({ mode: "monitor" }).mode).toBe("monitor")
  })
})
