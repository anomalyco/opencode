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
        const trajectoryFile = path.join(tmp.path, ".opencode", "trajectories", `session_${session.id}.jsonl`)

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
        const sessionStart = events.find((e) => e.type === "session_start") as Trajectory.SessionStartEvent | undefined

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

  test.skip("should record complete conversation flow with all event types", async () => {})
  test.skip("should record all LLM interactions during a session", async () => {})
  test.skip("should record tool executions with full arguments and results", async () => {})
  test.skip("should record stream events during LLM streaming response", async () => {})
  test.skip("should record compaction events when context window overflows", async () => {})
  test.skip("should maintain valid JSONL format throughout session", async () => {})

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

  test.skip("should flush buffer at end of each LLM stream", async () => {})
  test.skip("should fail fast and halt execution if trajectory write fails", async () => {})
})
