import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { SessionStatus } from "../../src/session/status"
import { TaskStatusTool } from "../../src/tool/task_status"
import { MessageV2 } from "../../src/session/message-v2"

const ctx = {
  sessionID: "session_test",
  messageID: "message_test",
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function user(sessionID: string) {
  await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: {
      created: Date.now(),
    },
    agent: "build",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
    },
  })
}

async function assistant(input: { sessionID: string; text: string; error?: string }) {
  const msg = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    time: {
      created: Date.now(),
      completed: Date.now(),
    },
    parentID: Identifier.ascending("message"),
    modelID: "test-model",
    providerID: "test-provider",
    mode: "build",
    agent: "build",
    path: {
      cwd: process.cwd(),
      root: process.cwd(),
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
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

  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: msg.id,
    type: "text",
    text: input.text,
  })
}

describe("tool.task_status", () => {
  test("returns running while session status is busy", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await TaskStatusTool.init()

        SessionStatus.set(session.id, { type: "busy" })
        const result = await tool.execute({ task_id: session.id }, ctx)

        expect(result.output).toContain("state: running")
        SessionStatus.set(session.id, { type: "idle" })
      },
    })
  })

  test("returns completed with final task output", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await TaskStatusTool.init()

        await assistant({
          sessionID: session.id,
          text: "all done",
        })

        const result = await tool.execute({ task_id: session.id }, ctx)
        expect(result.output).toContain("state: completed")
        expect(result.output).toContain("all done")
      },
    })
  })

  test("wait=true blocks until terminal status", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await TaskStatusTool.init()

        SessionStatus.set(session.id, { type: "busy" })
        const transition = Bun.sleep(150).then(async () => {
          SessionStatus.set(session.id, { type: "idle" })
          await assistant({
            sessionID: session.id,
            text: "finished later",
          })
        })

        const result = await tool.execute(
          {
            task_id: session.id,
            wait: true,
            timeout_ms: 4_000,
          },
          ctx,
        )

        await transition
        expect(result.output).toContain("state: completed")
        expect(result.output).toContain("finished later")
      },
    })
  })

  test("returns error when child run fails", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await TaskStatusTool.init()

        await assistant({
          sessionID: session.id,
          text: "",
          error: "child failed",
        })

        const result = await tool.execute({ task_id: session.id }, ctx)
        expect(result.output).toContain("state: error")
        expect(result.output).toContain("child failed")
        expect(result.metadata.state).toBe("error")
      },
    })
  })

  test("wait=true times out with timed_out metadata", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await TaskStatusTool.init()

        SessionStatus.set(session.id, { type: "busy" })
        const result = await tool.execute(
          {
            task_id: session.id,
            wait: true,
            timeout_ms: 80,
          },
          ctx,
        )

        expect(result.output).toContain("Timed out after 80ms")
        expect(result.metadata.timed_out).toBe(true)
        expect(result.metadata.state).toBe("running")
        SessionStatus.set(session.id, { type: "idle" })
      },
    })
  })

  test("returns running for resumed task with a newer user turn", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await TaskStatusTool.init()

        await user(session.id)
        await assistant({
          sessionID: session.id,
          text: "old done",
        })
        await user(session.id)

        const result = await tool.execute({ task_id: session.id }, ctx)
        expect(result.output).toContain("state: running")
        expect(result.output).toContain("Task is starting.")
      },
    })
  })
})
