import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Helper: seed a session with a user message + finished assistant message
// so loop() exits immediately without calling any LLM
async function seed(sessionID: SessionID) {
  const userMsg: MessageV2.Info = {
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
  }
  await Session.updateMessage(userMsg)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: userMsg.id,
    sessionID,
    type: "text",
    text: "hello",
  })

  const assistantMsg: MessageV2.Info = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: userMsg.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "gpt-5.2" as any,
    providerID: "openai" as any,
    time: { created: Date.now(), completed: Date.now() },
    finish: "stop",
  }
  await Session.updateMessage(assistantMsg)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: assistantMsg.id,
    sessionID,
    type: "text",
    text: "hi there",
  })

  return { userMsg, assistantMsg }
}

describe("session.prompt concurrency", () => {
  test("loop returns assistant message and sets status to idle", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await seed(session.id)

        const result = await SessionPrompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")

        const status = await SessionStatus.get(session.id)
        expect(status.type).toBe("idle")
      },
    })
  })

  test("concurrent loop callers get the same result", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await seed(session.id)

        const [a, b] = await Promise.all([
          SessionPrompt.loop({ sessionID: session.id }),
          SessionPrompt.loop({ sessionID: session.id }),
        ])

        expect(a.info.id).toBe(b.info.id)
        expect(a.info.role).toBe("assistant")
      },
    })
  })

  test("assertNotBusy throws when loop is running", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userMsg: MessageV2.Info = {
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        }
        await Session.updateMessage(userMsg)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMsg.id,
          sessionID: session.id,
          type: "text",
          text: "hello",
        })

        const ready = deferred()
        const gate = deferred()
        const getModel = spyOn(Provider, "getModel").mockImplementation(async () => {
          ready.resolve()
          await gate.promise
          throw new Error("test stop")
        })

        try {
          const loopPromise = SessionPrompt.loop({ sessionID: session.id }).catch(() => undefined)
          await ready.promise

          await expect(SessionPrompt.assertNotBusy(session.id)).rejects.toBeInstanceOf(Session.BusyError)

          gate.resolve()
          await loopPromise
        } finally {
          gate.resolve()
          getModel.mockRestore()
        }

        // After loop completes, assertNotBusy should succeed
        await SessionPrompt.assertNotBusy(session.id)
      },
    })
  })

  test("cancel sets status to idle", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // Seed only a user message — loop must call getModel to proceed
        const userMsg: MessageV2.Info = {
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        }
        await Session.updateMessage(userMsg)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMsg.id,
          sessionID: session.id,
          type: "text",
          text: "hello",
        })
        // Also seed an assistant message so lastAssistant() fallback can find it
        const assistantMsg: MessageV2.Info = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: userMsg.id,
          sessionID: session.id,
          mode: "build",
          agent: "build",
          cost: 0,
          path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistantMsg)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistantMsg.id,
          sessionID: session.id,
          type: "text",
          text: "hi there",
        })

        const ready = deferred()
        const gate = deferred()
        const getModel = spyOn(Provider, "getModel").mockImplementation(async () => {
          ready.resolve()
          await gate.promise
          throw new Error("test stop")
        })

        try {
          // Start loop — it will block in getModel (assistant has no finish, so loop continues)
          const loopPromise = SessionPrompt.loop({ sessionID: session.id })

          await ready.promise

          await SessionPrompt.cancel(session.id)

          const status = await SessionStatus.get(session.id)
          expect(status.type).toBe("idle")

          // loop should resolve cleanly, not throw "All fibers interrupted"
          const result = await loopPromise
          expect(result.info.role).toBe("assistant")
          expect(result.info.id).toBe(assistantMsg.id)
        } finally {
          gate.resolve()
          getModel.mockRestore()
        }
      },
    })
  }, 10000)

  test("cancel on idle session just sets idle", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionPrompt.cancel(session.id)
        const status = await SessionStatus.get(session.id)
        expect(status.type).toBe("idle")
      },
    })
  })
})
