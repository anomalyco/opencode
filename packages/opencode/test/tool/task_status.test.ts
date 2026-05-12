import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { TaskStatusTool } from "@/tool/task_status"
import { Truncate } from "@/tool/truncate"
import { Flag } from "@opencode-ai/core/flag/flag"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const originalBackgroundAgents = Flag.OPENCODE_EXPERIMENTAL_BACKGROUND_AGENTS

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_BACKGROUND_AGENTS = originalBackgroundAgents
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    Bus.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    Truncate.defaultLayer,
  ),
)

describe("tool.task_status", () => {
  it.instance("returns completed background job output", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_BACKGROUND_AGENTS = true
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const tool = yield* TaskStatusTool
      const def = yield* tool.init()
      const chat = yield* sessions.create({})

      yield* jobs.start({ id: chat.id, type: "task", run: Effect.succeed("all done") })

      const result = yield* def.execute(
        { task_id: chat.id, wait: true, timeout_ms: 1_000 },
        {
          sessionID: chat.id,
          messageID: MessageID.ascending(),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("state: completed")
      expect(result.output).toContain("all done")
      expect(result.metadata.timed_out).toBe(false)
    }),
  )

  it.instance("wait=true times out while the background job is running", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_BACKGROUND_AGENTS = true
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const tool = yield* TaskStatusTool
      const def = yield* tool.init()
      const chat = yield* sessions.create({})

      yield* jobs.start({ id: chat.id, type: "task", run: Effect.never })

      const result = yield* def.execute(
        { task_id: chat.id, wait: true, timeout_ms: 50 },
        {
          sessionID: chat.id,
          messageID: MessageID.ascending(),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("state: running")
      expect(result.output).toContain("Timed out after 50ms")
      expect(result.metadata.timed_out).toBe(true)
    }),
  )
})
