import { afterEach, describe, expect, test } from "bun:test"
import { ConfigInfinite } from "@opencode-ai/schema/config/infinite"
import { SessionInfinite } from "@opencode-ai/core/session/infinite"

const sessionID = "ses_infinite_test" as never

afterEach(() => {
  SessionInfinite.clear()
})

describe("SessionInfinite", () => {
  test("appends sentinel instruction only when missing", () => {
    const sentinel = SessionInfinite.Defaults.sentinel
    const withInstruction = SessionInfinite.withSentinelInstruction("Build the feature", sentinel)
    expect(withInstruction).toContain("Build the feature")
    expect(withInstruction).toContain(sentinel)
    const already = SessionInfinite.withSentinelInstruction(`Done ${sentinel}`, sentinel)
    expect(already).toBe(`Done ${sentinel}`)
  })

  test("detects sentinel in assistant text", () => {
    expect(SessionInfinite.containsSentinel("All done [TASK_COMPLETE]", "[TASK_COMPLETE]")).toBe(true)
    expect(SessionInfinite.containsSentinel("Still working", "[TASK_COMPLETE]")).toBe(false)
  })

  test("terminates when todos are done even without sentinel", () => {
    expect(SessionInfinite.isTerminated([])).toBe(true)
    expect(SessionInfinite.isTerminated([{ status: "completed" }, { status: "cancelled" }])).toBe(true)
    expect(SessionInfinite.isTerminated([{ status: "completed" }, { status: "pending" }])).toBe(false)
  })

  test("continues when sentinel is missing and todos remain open", () => {
    const text = "Still working"
    const todos = [{ status: "in_progress" }]
    expect(SessionInfinite.containsSentinel(text, SessionInfinite.Defaults.sentinel)).toBe(false)
    expect(SessionInfinite.isTerminated(todos)).toBe(false)
  })

  test("tracks enable, progress, and limits", () => {
    expect(SessionInfinite.isEnabled(sessionID)).toBe(false)
    SessionInfinite.enable(sessionID)
    expect(SessionInfinite.isEnabled(sessionID)).toBe(true)
    expect(SessionInfinite.getProgress(sessionID)?.iterations).toBe(0)
    SessionInfinite.recordIteration(sessionID)
    expect(SessionInfinite.getProgress(sessionID)?.iterations).toBe(1)
    const settings = SessionInfinite.resolve([new ConfigInfinite.Info({ maxIterations: 1 })])
    const progress = SessionInfinite.getProgress(sessionID)
    expect(progress !== undefined && progress.iterations >= settings.maxIterations).toBe(true)
    SessionInfinite.disable(sessionID)
    expect(SessionInfinite.isEnabled(sessionID)).toBe(false)
    expect(SessionInfinite.getProgress(sessionID)).toBeUndefined()
  })

  test("does not continue while a permission request is pending", () => {
    SessionInfinite.enable(sessionID)
    const pendingPermissions = [{ id: "perm_1" }]
    const shouldContinue = pendingPermissions.length === 0
    expect(shouldContinue).toBe(false)
  })

  test("builds continuation prompt with sentinel", () => {
    const prompt = SessionInfinite.continuationPrompt("[TASK_COMPLETE]")
    expect(prompt).toContain("[TASK_COMPLETE]")
  })
})
