import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { TurnCheckpoint } from "@opencode-ai/core/session/runner/checkpoint"
import { SpeculativeExecution } from "@opencode-ai/core/tool/speculative"
import { FailurePattern } from "@opencode-ai/core/session/failure-pattern"
import { ReflectionState } from "@opencode-ai/core/session/runner/reflection-state"

describe("Mid-Turn Checkpoint / Replay (Feature 11)", () => {
  const sessionID = "ses_checkpoint_test" as SessionSchema.ID
  const msgID = "msg_123" as SessionMessage.ID

  test("records settled tool calls sequentially within a turn", () => {
    TurnCheckpoint.clearCheckpoint(sessionID)
    expect(TurnCheckpoint.getCheckpoint(sessionID)).toBeUndefined()

    TurnCheckpoint.recordSettledTool(sessionID, {
      step: 1,
      assistantMessageID: msgID,
      call: {
        callID: "call_1",
        name: "read",
        input: { path: "src/a.ts" },
        result: { type: "text", value: "content a" },
        timestamp: Date.now(),
      },
    })

    const cp1 = TurnCheckpoint.getCheckpoint(sessionID)
    expect(cp1).toBeDefined()
    expect(cp1?.settledCalls.length).toBe(1)
    expect(cp1?.status).toBe("active")

    TurnCheckpoint.recordSettledTool(sessionID, {
      step: 1,
      assistantMessageID: msgID,
      call: {
        callID: "call_2",
        name: "read",
        input: { path: "src/b.ts" },
        result: { type: "text", value: "content b" },
        timestamp: Date.now(),
      },
    })

    const cp2 = TurnCheckpoint.getCheckpoint(sessionID)
    expect(cp2?.settledCalls.length).toBe(2)
  })

  test("marks crash and resumes already-settled tool calls on retry", () => {
    expect(TurnCheckpoint.canResumeFromCheckpoint(sessionID, 1)).toBe(false)

    TurnCheckpoint.markTurnCrashed(sessionID)
    expect(TurnCheckpoint.canResumeFromCheckpoint(sessionID, 1)).toBe(true)

    const resumed = TurnCheckpoint.resumeCheckpoint(sessionID, 1)
    expect(resumed?.length).toBe(2)
    expect(resumed?.[0].callID).toBe("call_1")
    expect(resumed?.[1].callID).toBe("call_2")

    // After clean settlement, checkpoint is cleared
    TurnCheckpoint.clearCheckpoint(sessionID)
    expect(TurnCheckpoint.getCheckpoint(sessionID)).toBeUndefined()
  })
})

describe("Speculative Tool Execution (Feature 9)", () => {
  test("extracts file paths from thought and reasoning text", () => {
    const text = 'Let me inspect `package.json` to verify dependencies, then read "src/index.ts".'
    const paths = SpeculativeExecution.extractSpeculativeReadPaths(text)
    expect(paths).toContain("package.json")
    expect(paths).toContain("src/index.ts")
  })

  test("caches and retrieves speculative results", () => {
    SpeculativeExecution.clearCache()
    const key = SpeculativeExecution.cacheKey("read", { path: "test.txt" })
    expect(SpeculativeExecution.getCached(key)).toBeUndefined()

    const mockData = { type: "text", content: "hello speculative world" }
    SpeculativeExecution.setCached("read", { path: "test.txt" }, mockData)

    const cached = SpeculativeExecution.getCached(key)
    expect(cached).toEqual(mockData)
  })

  test("prefetches file and stores FileSystem.Content conformant payload", async () => {
    const pkgPath = path.resolve(__dirname, "../../package.json")
    const prefetched = await Effect.runPromise(SpeculativeExecution.prefetchFile(pkgPath))
    expect(prefetched).toBeDefined()
    expect(prefetched?.name).toBe("package.json")
    expect(prefetched?.encoding).toBe("utf8")
    expect(prefetched?.content).toContain("@opencode-ai/core")

    const key = SpeculativeExecution.cacheKey("read", { path: pkgPath })
    const cached = SpeculativeExecution.getCached<any>(key)
    expect(cached).toBeDefined()
    expect(cached?.content).toBe(prefetched?.content)
    expect(cached?.mime).toBe("application/json")
  })
})

describe("Auto-Healing Failure Patterns (Feature 10)", () => {
  test("normalizes error messages and stack traces into canonical signatures", () => {
    const rawError1 = "ENOENT: no such file or directory, open '/home/user/project/src/index.ts'"
    const rawError2 = "ENOENT: no such file or directory, open '/var/deploy/app/src/index.ts'"

    const sig1 = FailurePattern.normalizeSignature(rawError1)
    const sig2 = FailurePattern.normalizeSignature(rawError2)

    expect(sig1).toContain("<path>")
    expect(sig1).toBe(sig2)
  })

  test("looks up known resolutions for common fatal errors", () => {
    const res = FailurePattern.lookupResolution("Error: Cannot find module '@types/node'")
    expect(res).toBeDefined()
    expect(res?.name).toBe("Missing Dependency")
    expect(res?.recommendedAction).toContain("bun add")

    const portRes = FailurePattern.lookupResolution("listen EADDRINUSE: address already in use :::3000")
    expect(portRes).toBeDefined()
    expect(portRes?.name).toBe("Port Conflict")
  })

  test("applies resolution as steer and reasoning log in session", () => {
    const sessionID = "ses_heal_test" as SessionSchema.ID
    ReflectionState.clear(sessionID)

    const res = FailurePattern.lookupResolution("index.lock': File exists")
    expect(res).toBeDefined()

    if (res) {
      FailurePattern.applyResolutionToSession(sessionID, res)
      expect(ReflectionState.hasSteers(sessionID)).toBe(true)
      const steerGuidance = ReflectionState.consumeSteerGuidanceText(sessionID)
      expect(steerGuidance).toBeDefined()
      expect(steerGuidance).toContain("Auto-Healing Matched Known Failure")
      const logs = ReflectionState.getReasoningLog(sessionID)
      expect(logs.some((l) => l.content.includes("Auto-healing applied resolution"))).toBe(true)
    }
  })
})
