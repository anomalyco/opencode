import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { TrajectoryRecorder } from "../../src/trajectory/recorder"
import type { Trajectory } from "../../src/trajectory/types"
import { tmpdir } from "../fixture/fixture"

/**
 * Core recorder tests - focus on file writing, JSONL format, and buffering.
 * These validate the actual trajectory recording mechanism works.
 */
describe("TrajectoryRecorder", () => {
  test("should write events to JSONL file", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "test.jsonl")
    const sessionID = "test-session"

    TrajectoryRecorder.start(sessionID, {
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      filePath,
    })

    await TrajectoryRecorder.record(sessionID, {
      type: "session_start",
      timestamp: Date.now(),
      sessionID,
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      workingDirectory: "/test",
    })

    await TrajectoryRecorder.record(sessionID, {
      type: "session_end",
      timestamp: Date.now(),
      sessionID,
      success: true,
      exitReason: "completed",
      summary: {
        totalSteps: 1,
        totalLLMCalls: 1,
        totalToolCalls: 0,
        totalTokens: { input: 100, output: 50, reasoning: 0 },
        totalDuration: 1000,
      },
    })

    await TrajectoryRecorder.stop(sessionID)

    // Verify file exists and has valid JSONL
    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(2)

    // Each line should be valid JSON
    const events = lines.map((line) => JSON.parse(line) as Trajectory.Event)
    expect(events[0].type).toBe("session_start")
    expect(events[1].type).toBe("session_end")
  })

  test("should maintain valid JSONL format with multiple events", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "test.jsonl")
    const sessionID = "test-session"

    TrajectoryRecorder.start(sessionID, {
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      filePath,
    })

    // Write 100 events
    for (let i = 0; i < 100; i++) {
      await TrajectoryRecorder.record(sessionID, {
        type: "agent_step",
        timestamp: Date.now(),
        sessionID,
        step: i + 1,
        action: "loop_start",
        state: {
          messageCount: i + 1,
          hasSnapshot: false,
          contextOverflow: false,
        },
      })
    }

    await TrajectoryRecorder.stop(sessionID)

    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(100)

    // Every line should be valid JSON
    lines.forEach((line, i) => {
      const event = JSON.parse(line)
      expect(event.type).toBe("agent_step")
      expect(event.step).toBe(i + 1)
    })
  })

  test("should flush at end of LLM stream", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "test.jsonl")
    const sessionID = "test-session"

    TrajectoryRecorder.start(sessionID, {
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      filePath,
    })

    TrajectoryRecorder.markStreamStart(sessionID)

    // Record stream events
    await TrajectoryRecorder.record(sessionID, {
      type: "stream_event",
      timestamp: Date.now(),
      sessionID,
      messageID: "msg_1",
      step: 1,
      eventType: "response",
      data: { text: "Hello" },
    })

    await TrajectoryRecorder.record(sessionID, {
      type: "stream_event",
      timestamp: Date.now(),
      sessionID,
      messageID: "msg_1",
      step: 1,
      eventType: "response",
      data: { text: " world" },
    })

    // Mark stream end - should flush
    await TrajectoryRecorder.markStreamEnd(sessionID)

    // Verify events were written
    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(2)

    await TrajectoryRecorder.stop(sessionID)
  })

  test("should record complete event data without truncation", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "test.jsonl")
    const sessionID = "test-session"

    TrajectoryRecorder.start(sessionID, {
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      filePath,
    })

    // Large tool output (10KB)
    const largeOutput = "x".repeat(10000)

    await TrajectoryRecorder.record(sessionID, {
      type: "tool_execution",
      timestamp: Date.now(),
      sessionID,
      messageID: "msg_1",
      step: 1,
      tool: "bash",
      callID: "call_1",
      input: { command: "cat largefile.txt" },
      status: "completed",
      startTime: Date.now(),
      endTime: Date.now() + 100,
      duration: 100,
      result: {
        title: "Read file",
        output: largeOutput,
      },
    })

    await TrajectoryRecorder.stop(sessionID)

    const content = await fs.readFile(filePath, "utf-8")
    const event = JSON.parse(content.trim()) as Trajectory.ToolExecutionEvent

    // Verify full output was recorded
    expect(event.result?.output.length).toBe(10000)
    expect(event.result?.output).toBe(largeOutput)
  })

  test("should append to file for multiple sessions", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "shared.jsonl")

    // Session 1
    TrajectoryRecorder.start("session-1", {
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      filePath,
    })

    await TrajectoryRecorder.record("session-1", {
      type: "session_start",
      timestamp: Date.now(),
      sessionID: "session-1",
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      workingDirectory: "/test",
    })

    await TrajectoryRecorder.stop("session-1")

    // Session 2 - same file
    TrajectoryRecorder.start("session-2", {
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      filePath,
    })

    await TrajectoryRecorder.record("session-2", {
      type: "session_start",
      timestamp: Date.now(),
      sessionID: "session-2",
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      workingDirectory: "/test",
    })

    await TrajectoryRecorder.stop("session-2")

    // Verify both sessions in file
    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(2)

    const events = lines.map((line) => JSON.parse(line))
    expect(events[0].sessionID).toBe("session-1")
    expect(events[1].sessionID).toBe("session-2")
  })

  test("should throw error if recording fails", async () => {
    const sessionID = "test-session"
    const invalidPath = "/invalid/nonexistent/path/test.jsonl"

    TrajectoryRecorder.start(sessionID, {
      agent: "general",
      model: { provider: "anthropic", id: "claude-4" },
      filePath: invalidPath,
    })

    // Should throw on first write
    await expect(
      TrajectoryRecorder.record(sessionID, {
        type: "session_start",
        timestamp: Date.now(),
        sessionID,
        agent: "general",
        model: { provider: "anthropic", id: "claude-4" },
        workingDirectory: "/test",
      }),
    ).rejects.toThrow()
  })

  test("should throw if recording to session that hasn't started", async () => {
    await expect(
      TrajectoryRecorder.record("nonexistent-session", {
        type: "session_start",
        timestamp: Date.now(),
        sessionID: "nonexistent-session",
        agent: "general",
        model: { provider: "anthropic", id: "claude-4" },
        workingDirectory: "/test",
      }),
    ).rejects.toThrow()
  })
})
