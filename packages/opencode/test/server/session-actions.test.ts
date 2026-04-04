import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

async function user(sessionID: SessionID, text: string) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: msg.id,
    type: "text",
    text,
  })
  return msg
}

async function assistant(sessionID: SessionID, parentID: string, opts?: Partial<MessageV2.Assistant>) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant" as const,
    sessionID,
    parentID: MessageID.make(parentID),
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    time: { created: Date.now(), completed: Date.now() },
    ...opts,
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: msg.id,
    type: "text",
    text: "assistant response",
  })
  return msg
}

describe("session action routes", () => {
  test("abort route calls SessionPrompt.cancel", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const cancel = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/abort`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(cancel).toHaveBeenCalledWith(session.id)

        await Session.remove(session.id)
      },
    })
  })

  test("delete message route returns 400 when session is busy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const busy = spyOn(SessionPrompt, "assertNotBusy").mockRejectedValue(new Session.BusyError(session.id))
        const remove = spyOn(Session, "removeMessage").mockResolvedValue(msg.id)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/message/${msg.id}`, {
          method: "DELETE",
        })

        expect(res.status).toBe(400)
        expect(busy).toHaveBeenCalledWith(session.id)
        expect(remove).not.toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("continue route calls SessionPrompt.continue_", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const result: MessageV2.WithParts = {
          info: {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: session.id,
            parentID: msg.id,
            mode: "build",
            agent: "build",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelID.make("test"),
            providerID: ProviderID.make("test"),
            time: { created: Date.now() },
            finish: "stop",
          },
          parts: [],
        }
        const spy = spyOn(SessionPrompt, "continue_").mockResolvedValue(result)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/continue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.info.role).toBe("assistant")
        expect(spy).toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("continue route returns 400 when session is busy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const spy = spyOn(SessionPrompt, "continue_").mockRejectedValue(new Session.BusyError(session.id))
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/continue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(400)
        expect(spy).toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("continue route returns 400 when nothing to continue", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const spy = spyOn(SessionPrompt, "continue_").mockRejectedValue(new Session.NothingToContinueError(session.id))
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/continue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(400)
        expect(spy).toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("continue route works without body", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const result: MessageV2.WithParts = {
          info: {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: session.id,
            parentID: msg.id,
            mode: "build",
            agent: "build",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelID.make("test"),
            providerID: ProviderID.make("test"),
            time: { created: Date.now() },
            finish: "stop",
          },
          parts: [],
        }
        const spy = spyOn(SessionPrompt, "continue_").mockResolvedValue(result)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/continue`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(spy).toHaveBeenCalledWith(session.id)

        await Session.remove(session.id)
      },
    })
  })
})

describe("continue_ logic", () => {
  test("sends new prompt when assistant finished normally", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        await assistant(session.id, usr.id, { finish: "stop" })

        // The cleanly-finished path calls prompt() which creates a "continue"
        // user message then starts a loop. Without a real LLM it throws.
        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        // A new user message with text "continue" should have been persisted
        const msgs = await Session.messages({ sessionID: session.id })
        const users = msgs.filter((m) => m.info.role === "user")
        expect(users.length).toBe(2)

        await Session.remove(session.id)
      },
    })
  })

  test("sends new prompt when finish is 'length' and no error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        await assistant(session.id, usr.id, { finish: "length" })

        // "length" with no error takes the cleanly-finished path (sends "continue")
        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        const msgs = await Session.messages({ sessionID: session.id })
        const users = msgs.filter((m) => m.info.role === "user")
        expect(users.length).toBe(2)

        await Session.remove(session.id)
      },
    })
  })

  test("throws when no assistant message exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await user(session.id, "hello")

        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeInstanceOf(Session.NothingToContinueError)
        expect(err.message).toContain("Nothing to continue")
        expect(err.sessionID).toBe(session.id)

        await Session.remove(session.id)
      },
    })
  })

  test("throws when session has no messages at all", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeInstanceOf(Session.NothingToContinueError)
        expect(err.sessionID).toBe(session.id)

        await Session.remove(session.id)
      },
    })
  })

  test("clears error on aborted assistant and re-enters loop", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        await assistant(session.id, usr.id, {
          finish: "stop",
          error: { name: "MessageAbortedError", data: { message: "cancelled" } },
        })

        // continue_ patches the assistant and calls runLoop,
        // which will fail without a real LLM
        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        // The assistant should be kept but patched
        const msgs = await Session.messages({ sessionID: session.id })
        const ast = msgs.findLast((m) => m.info.role === "assistant")
        expect(ast).toBeDefined()
        if (ast?.info.role === "assistant") {
          expect(ast.info.error).toBeUndefined()
          expect(ast.info.finish).toBe("tool-calls")
        }

        await Session.remove(session.id)
      },
    })
  })

  test("patches interrupted assistant (no finish) and re-enters loop", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        await assistant(session.id, usr.id, { finish: undefined })

        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        const msgs = await Session.messages({ sessionID: session.id })
        const ast = msgs.findLast((m) => m.info.role === "assistant")
        expect(ast).toBeDefined()
        if (ast?.info.role === "assistant") {
          expect(ast.info.finish).toBe("tool-calls")
          expect(ast.info.time.completed).toBeDefined()
        }

        await Session.remove(session.id)
      },
    })
  })

  test("continue on interrupted path touches session timestamp", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const before = (await Session.get(session.id)).time.updated

        const usr = await user(session.id, "hello")
        await assistant(session.id, usr.id, { finish: undefined })

        // Small delay so updated timestamp is distinguishable
        await new Promise((r) => setTimeout(r, 10))

        await SessionPrompt.continue_(session.id).catch(() => {})

        const after = (await Session.get(session.id)).time.updated
        expect(after).toBeGreaterThan(before)

        await Session.remove(session.id)
      },
    })
  })

  test("does not early-return when assistant has finish but pending tool parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        const ast = await assistant(session.id, usr.id, { finish: "stop" })

        // Add a tool part to the assistant — simulates providers that return
        // "stop" even when tool calls are present.
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: ast.id,
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "pending",
            input: { command: "echo hi" },
            raw: '{"command":"echo hi"}',
          },
        })

        // continue_ should NOT early-return; it should patch the assistant
        // and re-enter the loop (which will fail without a real LLM).
        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        // The assistant should be kept and patched
        const msgs = await Session.messages({ sessionID: session.id })
        const ast2 = msgs.findLast((m) => m.info.role === "assistant")
        expect(ast2).toBeDefined()
        if (ast2?.info.role === "assistant") {
          expect(ast2.info.finish).toBe("tool-calls")
          expect(ast2.info.error).toBeUndefined()
        }

        await Session.remove(session.id)
      },
    })
  })

  test("patches assistant when finish is 'tool-calls' with no error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        await assistant(session.id, usr.id, { finish: "tool-calls" })

        // finish="tool-calls" skips the early-return path and patches the assistant
        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        const msgs = await Session.messages({ sessionID: session.id })
        const ast = msgs.findLast((m) => m.info.role === "assistant")
        expect(ast).toBeDefined()
        if (ast?.info.role === "assistant") {
          expect(ast.info.finish).toBe("tool-calls")
          expect(ast.info.error).toBeUndefined()
        }

        // Should NOT have created a new user message
        const users = msgs.filter((m) => m.info.role === "user")
        expect(users.length).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("sends new prompt when finish is set and all tool parts are completed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        const ast = await assistant(session.id, usr.id, { finish: "stop" })

        // Add a completed tool part — no pending tools remain.
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: ast.id,
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo hi" },
            output: "hi",
            title: "bash",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })

        // finish="stop" + no pending tools takes the cleanly-finished path,
        // which sends a "continue" prompt (requires LLM, so it throws here).
        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        const msgs = await Session.messages({ sessionID: session.id })
        const users = msgs.filter((m) => m.info.role === "user")
        expect(users.length).toBe(2)

        await Session.remove(session.id)
      },
    })
  })

  test("continues based on latest assistant when multiple exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        // First assistant finished cleanly
        await assistant(session.id, usr.id, { finish: "stop" })
        // Second assistant was interrupted (no finish)
        await assistant(session.id, usr.id, { finish: undefined })

        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        // Should patch the LATEST assistant (the interrupted one)
        const msgs = await Session.messages({ sessionID: session.id })
        const assistants = msgs.filter((m) => m.info.role === "assistant")
        expect(assistants.length).toBe(2)
        const latest = assistants[assistants.length - 1]
        if (latest.info.role === "assistant") {
          expect(latest.info.finish).toBe("tool-calls")
          expect(latest.info.time.completed).toBeDefined()
        }

        await Session.remove(session.id)
      },
    })
  })

  test("does not early-return when assistant has running tool parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usr = await user(session.id, "hello")
        const ast = await assistant(session.id, usr.id, { finish: "stop" })

        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: ast.id,
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "running",
            input: { command: "echo hi" },
            raw: '{"command":"echo hi"}',
            title: "bash",
            metadata: {},
            time: { start: Date.now() },
          },
        })

        const err = await SessionPrompt.continue_(session.id).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()

        const msgs = await Session.messages({ sessionID: session.id })
        const ast2 = msgs.findLast((m) => m.info.role === "assistant")
        expect(ast2).toBeDefined()
        if (ast2?.info.role === "assistant") {
          expect(ast2.info.finish).toBe("tool-calls")
          expect(ast2.info.error).toBeUndefined()
        }

        await Session.remove(session.id)
      },
    })
  })

  test("NothingToContinueError has correct sessionID property", () => {
    const id = "test-session-id"
    const err = new Session.NothingToContinueError(id)
    expect(err).toBeInstanceOf(Error)
    expect(err.sessionID).toBe(id)
    expect(err.message).toBe(`Nothing to continue in session ${id}`)
  })
})
