import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { ManageSubagentTool } from "../../src/tool/manage-subagent"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = () =>
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      BackgroundJob.node,
      EventV2Bridge.node,
      Config.node,
      CrossSpawnSpawner.node,
      Session.node,
      SessionProjector.node,
      SessionRunState.node,
      SessionStatus.node,
      Truncate.node,
      ToolRegistry.node,
      Database.node,
      RuntimeFlags.node,
      Ripgrep.node,
    ]),
  )

const it = testEffect(layer())

const seed = Effect.fn("ManageSubagentTest.seed")(function* (title = "Test Session") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

describe("tool.manage_subagent", () => {
  it.instance("list returns empty when no tasks are running", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* ManageSubagentTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        { task_id: "none", action: "list" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {},
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("No running subagent tasks")
    }),
  )

  it.instance("list shows running tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()

      yield* jobs.start({
        id: "test-task-1",
        type: "task",
        title: "test investigation",
        metadata: { parentSessionId: chat.id, sessionId: "ses_test" },
        run: Effect.never,
      })

      const tool = yield* ManageSubagentTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        { task_id: "none", action: "list" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {},
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("test-task-1")
      expect(result.output).toContain("test investigation")
      yield* jobs.cancel("test-task-1")
    }),
  )

  it.instance("cancel stops a running task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()

      yield* jobs.start({
        id: "test-cancel-1",
        type: "task",
        title: "cancel test",
        run: Effect.never,
      })

      const tool = yield* ManageSubagentTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        { task_id: "test-cancel-1", action: "cancel" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {},
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("Successfully cancelled")
      expect((yield* jobs.get("test-cancel-1"))?.status).toBe("cancelled")
    }),
  )

  it.instance("cancel returns error for unknown task", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* ManageSubagentTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        { task_id: "nonexistent", action: "cancel" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {},
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("No running task found")
    }),
  )

  it.instance("status shows task details", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()

      yield* jobs.start({
        id: "test-status-1",
        type: "task",
        title: "status check",
        run: Effect.never,
      })

      const tool = yield* ManageSubagentTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        { task_id: "test-status-1", action: "status" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {},
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("status check")
      expect(result.output).toContain("Status: running")
      yield* jobs.cancel("test-status-1")
    }),
  )
})
