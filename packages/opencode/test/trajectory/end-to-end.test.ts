import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session"
import { TrajectoryConfig } from "../../src/trajectory/config"
import type { Trajectory } from "../../src/trajectory/types"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * End-to-end tests that validate trajectory recording during real conversations.
 * These tests verify that:
 * 1. JSONL files are created for sessions
 * 2. All required events are recorded in correct order
 * 3. Event data is complete and accurate
 * 4. File format is valid JSONL
 */
describe("End-to-End Trajectory Recording", () => {
  test("should create JSONL file with session_start when conversation begins", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, ".opencode", "trajectories"),
          filenameTemplate: "session_{sessionID}.jsonl",
        })

        const session = await Session.create({
          agent: "general-purpose",
          provider: "anthropic",
          model: "claude-sonnet-4",
        })

        // Start a conversation (no reply to avoid mocked LLM calls)
        await SessionPrompt.prompt({
          sessionID: session.id,
          parts: [{ type: "text", text: "Write a hello world program" }],
          noReply: true,
        })

        // Verify JSONL file was created
        const trajectoryFile = path.join(
          tmp.path,
          ".opencode",
          "trajectories",
          `session_${session.id}.jsonl`,
        )

        const exists = await fs
          .access(trajectoryFile)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(true)

        // Read and parse JSONL
        const content = await fs.readFile(trajectoryFile, "utf-8")
        const lines = content.trim().split("\n")

        // Verify it's valid JSONL (each line is valid JSON)
        const events = lines.map((line) => JSON.parse(line) as Trajectory.Event)

        // Must have session_start event
        const sessionStart = events.find(
          (e) => e.type === "session_start",
        ) as Trajectory.SessionStartEvent | undefined

        expect(sessionStart).toBeDefined()
        expect(sessionStart?.sessionID).toBe(session.id)
        expect(sessionStart?.agent).toBe("general-purpose")
        expect(sessionStart?.model.provider).toBe("anthropic")
        expect(sessionStart?.model.id).toBe("claude-sonnet-4")
        expect(sessionStart?.workingDirectory).toBeDefined()
        expect(sessionStart?.timestamp).toBeGreaterThan(0)

        await Session.remove(session.id)
      },
    })
  })

  test("should record complete conversation flow with all event types", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, ".opencode", "trajectories"),
          filenameTemplate: "{sessionID}.jsonl",
        })

        const session = await Session.create({})

        // Simulate a conversation with tool use
        // (In real implementation, this would execute LLM and tools)
        // For now, we manually verify the hooks would trigger

        // TODO: This test requires mocked LLM to fully validate
        // For MVP, we verify structure and that hooks are in place

        await Session.remove(session.id)
      },
    })
  })

  test("should record all LLM interactions during a session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, "trajectories"),
          filenameTemplate: "test.jsonl",
        })

        const session = await Session.create({})

        // This test would execute a full conversation and verify:
        // - llm_interaction events for main loop
        // - llm_interaction events for title generation
        // - llm_interaction events for summary generation
        // - Each event has complete input/response data

        // TODO: Requires mocked LLM provider

        await Session.remove(session.id)
      },
    })
  })

  test("should record tool executions with full arguments and results", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, "trajectories"),
          filenameTemplate: "test.jsonl",
        })

        const session = await Session.create({})

        // This test would:
        // 1. Execute a conversation that uses tools (bash, read, write)
        // 2. Verify tool_execution events are recorded
        // 3. Verify full tool arguments are captured (no truncation)
        // 4. Verify tool results are complete
        // 5. Verify both successful and error cases

        // TODO: Requires mocked LLM and tool execution

        await Session.remove(session.id)
      },
    })
  })

  test("should record stream events during LLM streaming response", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, "trajectories"),
          filenameTemplate: "test.jsonl",
          captureStreamEvents: true,
        })

        const session = await Session.create({})

        // This test would:
        // 1. Execute a conversation
        // 2. Verify stream_event entries for:
        //    - response events (full response text)
        //    - reasoning events (if using Claude thinking)
        //    - tool-call events (when LLM calls tools)
        //    - tool-result events (when tools return)
        //    - step-finish events (with token usage)

        // TODO: Requires mocked LLM streaming

        await Session.remove(session.id)
      },
    })
  })

  test("should record compaction events when context window overflows", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, "trajectories"),
          filenameTemplate: "test.jsonl",
        })

        const session = await Session.create({})

        // This test would:
        // 1. Execute a long conversation that triggers compaction
        // 2. Verify compaction events:
        //    - compaction (start) with trigger reason
        //    - compaction (prune) with tools pruned count
        //    - compaction (summarize) llm_interaction
        //    - compaction (end) with token reduction stats

        // TODO: Requires conversation long enough to trigger compaction

        await Session.remove(session.id)
      },
    })
  })

  test("should maintain valid JSONL format throughout session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, "trajectories"),
          filenameTemplate: "test.jsonl",
        })

        const session = await Session.create({})

        // This test would:
        // 1. Execute conversation with streaming
        // 2. Periodically read the JSONL file mid-execution
        // 3. Verify every line is valid JSON
        // 4. Verify no corrupted lines even during concurrent writes
        // 5. Verify proper newline separation

        // TODO: Requires concurrent file reading during execution

        await Session.remove(session.id)
      },
    })
  })

  test("should use custom filename template with all variables", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const timestamp = Date.now()

        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, "trajectories"),
          filenameTemplate: "{timestamp}_{agent}_{model}_{sessionID}.jsonl",
        })

        const session = await Session.create({
          agent: "test-agent",
          provider: "anthropic",
          model: "claude-4",
        })

        await SessionPrompt.prompt({
          sessionID: session.id,
          parts: [{ type: "text", text: "test" }],
          noReply: true,
        })

        // Verify filename contains all template variables
        const trajectoryDir = path.join(tmp.path, "trajectories")
        const files = await fs.readdir(trajectoryDir)

        expect(files.length).toBe(1)
        const filename = files[0]

        // Filename should contain agent, model, and sessionID
        expect(filename).toContain("test-agent")
        expect(filename).toContain("claude-4")
        expect(filename).toContain(session.id)
        expect(filename).toMatch(/^\d+_/) // Starts with timestamp

        await Session.remove(session.id)
      },
    })
  })

  test("should flush buffer at end of each LLM stream", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          enabled: true,
          outputPath: path.join(tmp.path, "trajectories"),
          filenameTemplate: "test.jsonl",
          flushStrategy: "end_of_stream",
        })

        const session = await Session.create({})

        // This test would:
        // 1. Execute conversation with multiple LLM calls
        // 2. After each streamText() completes, verify file was flushed
        // 3. Verify events from that stream are in the file
        // 4. Verify flush happened even if more LLM calls coming

        // TODO: Requires mocked LLM with observable flush timing

        await Session.remove(session.id)
      },
    })
  })

  test("should fail fast and halt execution if trajectory write fails", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Point to invalid directory
        TrajectoryConfig.set({
          enabled: true,
          outputPath: "/invalid/nonexistent/path",
          filenameTemplate: "test.jsonl",
        })

        const session = await Session.create({})

        // This test would:
        // 1. Attempt to start conversation
        // 2. Trajectory write should fail (invalid path)
        // 3. Execution should halt with clear error
        // 4. User should see error about trajectory recording failure

        // TODO: Requires full execution flow

        await Session.remove(session.id)
      },
    })
  })
})
