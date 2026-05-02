import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Scope } from "effect"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { TaskStatusTool } from "../../src/tool/task_status"
import { Truncate } from "@/tool/truncate"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { BackgroundJob } from "@/background/job"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    BackgroundJob.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const seedUser = Effect.fn("TaskStatusToolTest.seedUser")(function* (sessionID: Session.Info["id"]) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
})

const seedAssistant = Effect.fn("TaskStatusToolTest.seedAssistant")(function* (input: {
  sessionID: Session.Info["id"]
  text: string
  error?: string
}) {
  const session = yield* Session.Service
  const user = yield* seedUser(input.sessionID)
  const message = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: input.sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now(), completed: Date.now() },
    finish: "stop",
    ...(input.error
      ? {
          error: new MessageV2.APIError({
            message: input.error,
            isRetryable: false,
          }).toObject(),
        }
      : {}),
  })

  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: message.id,
    sessionID: input.sessionID,
    type: "text",
    text: input.text,
  })
})

describe("tool.task_status", () => {
  it.live("returns running while session status is busy", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const status = yield* SessionStatus.Service
        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const chat = yield* sessions.create({})

        yield* status.set(chat.id, { type: "busy" })
        const result = yield* def.execute(
          { task_id: chat.id },
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
      }),
    ),
  )

  it.live("returns completed with final task output", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const chat = yield* sessions.create({})

        yield* seedAssistant({ sessionID: chat.id, text: "all done" })

        const result = yield* def.execute(
          { task_id: chat.id },
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
      }),
    ),
  )

  it.live("wait=true blocks until terminal status", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const status = yield* SessionStatus.Service
        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const chat = yield* sessions.create({})
        const scope = yield* Scope.Scope

        yield* status.set(chat.id, { type: "busy" })
        yield* Effect.gen(function* () {
          yield* Effect.sleep("150 millis")
          yield* status.set(chat.id, { type: "idle" })
          yield* seedAssistant({ sessionID: chat.id, text: "finished later" })
        }).pipe(Effect.forkIn(scope))

        const result = yield* def.execute(
          {
            task_id: chat.id,
            wait: true,
            timeout_ms: 4_000,
          },
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
        expect(result.output).toContain("finished later")
      }),
    ),
  )

  it.live("returns error when child run fails", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const chat = yield* sessions.create({})

        yield* seedAssistant({ sessionID: chat.id, text: "", error: "child failed" })

        const result = yield* def.execute(
          { task_id: chat.id },
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

        expect(result.output).toContain("state: error")
        expect(result.output).toContain("child failed")
        expect(result.metadata.state).toBe("error")
      }),
    ),
  )

  it.live("wait=true times out with timed_out metadata", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const status = yield* SessionStatus.Service
        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const chat = yield* sessions.create({})

        yield* status.set(chat.id, { type: "busy" })
        const result = yield* def.execute(
          {
            task_id: chat.id,
            wait: true,
            timeout_ms: 80,
          },
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

        expect(result.output).toContain("Timed out after 80ms")
        expect(result.metadata.timed_out).toBe(true)
        expect(result.metadata.state).toBe("running")
      }),
    ),
  )

  it.live("returns running for resumed task with a newer user turn", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tool = yield* TaskStatusTool
        const def = yield* tool.init()
        const chat = yield* sessions.create({})

        yield* seedAssistant({ sessionID: chat.id, text: "old done" })
        yield* seedUser(chat.id)

        const result = yield* def.execute(
          { task_id: chat.id },
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
        expect(result.output).toContain("Task is starting.")
      }),
    ),
  )
})
