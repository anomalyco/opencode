import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Sidekick } from "../../src/session/sidekick"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("sidekick creation", () => {
  test("ensure creates sidekick for parent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const result = await Sidekick.ensure(session.id)

        expect(result.kind).toBe("sidekick")
        expect(result.parentID).toBe(session.id)

        await Session.remove(session.id)
      },
    })
  })

  test("ensure returns same sidekick on repeated calls", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const first = await Sidekick.ensure(session.id)
        const second = await Sidekick.ensure(session.id)

        expect(first.id).toBe(second.id)

        await Session.remove(session.id)
      },
    })
  })

  test("rejects sidekick of sidekick", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const sidekick = await Sidekick.ensure(session.id)

        await expect(Sidekick.ensure(sidekick.id)).rejects.toThrow("Cannot create a sidekick of a sidekick session")

        await Session.remove(session.id)
      },
    })
  })

  test("Session.create rejects sidekick without parentID", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(Session.create({ kind: "sidekick" })).rejects.toThrow("Sidekick sessions require a parentID")
      },
    })
  })
})

describe("sidekick filtering", () => {
  test("Session.list excludes sidekick sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        await Sidekick.ensure(session.id)

        const list = [...Session.list()]
        const ids = list.map((s) => s.id)

        expect(ids).toContain(session.id)
        expect(ids.every((id) => list.find((s) => s.id === id)?.kind !== "sidekick")).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("Session.children excludes sidekick sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const parent = await Session.create({})

        const child = await Session.create({ parentID: parent.id })
        await Sidekick.ensure(parent.id)

        const kids = await Session.children(parent.id)
        const ids = kids.map((s) => s.id)

        expect(ids).toContain(child.id)
        expect(kids.every((s) => s.kind !== "sidekick")).toBe(true)

        await Session.remove(parent.id)
      },
    })
  })

  test("Session.list with kind=sidekick returns sidekick", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const sidekick = await Sidekick.ensure(session.id)

        const list = [...Session.list({ kind: "sidekick" })]
        const ids = list.map((s) => s.id)

        expect(ids).toContain(sidekick.id)

        await Session.remove(session.id)
      },
    })
  })
})

describe("sidekick context", () => {
  test("builds context from parent messages", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const userMsgID = MessageID.ascending()
        await Session.updateMessage({
          id: userMsgID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMsgID,
          sessionID: session.id,
          type: "text",
          text: "Hello from user",
        } satisfies MessageV2.TextPart)

        const asstMsgID = MessageID.ascending()
        await Session.updateMessage({
          id: asstMsgID,
          sessionID: session.id,
          role: "assistant",
          parentID: userMsgID,
          time: { created: Date.now() },
          agent: "build",
          modelID: "test",
          providerID: "test",
          mode: "",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } as unknown as MessageV2.Info)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: asstMsgID,
          sessionID: session.id,
          type: "text",
          text: "Hello from assistant",
        } satisfies MessageV2.TextPart)

        const result = await Sidekick.context({ parentID: session.id, limit: 30 })

        expect(result).toContain("<main_conversation>")
        expect(result).toContain("[User]: Hello from user")
        expect(result).toContain("[Assistant]: Hello from assistant")
        expect(result).toContain("</main_conversation>")

        await Session.remove(session.id)
      },
    })
  })

  test("returns empty string for session with no messages", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const result = await Sidekick.context({ parentID: session.id, limit: 30 })

        expect(result).toBe("")

        await Session.remove(session.id)
      },
    })
  })
})

describe("sidekick inject", () => {
  test("creates user message in parent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Add a user message so inject can reuse its agent/model
        const userMsgID = MessageID.ascending()
        await Session.updateMessage({
          id: userMsgID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)

        const msg = await Sidekick.inject({ parentID: session.id, text: "test conclusion" })

        expect(msg.role).toBe("user")
        expect(msg.sessionID).toBe(session.id)

        const msgs = await Session.messages({ sessionID: session.id })
        const injected = msgs.find((m) => m.info.id === msg.id)
        expect(injected).toBeDefined()
        const textPart = injected!.parts.find((p) => p.type === "text")
        expect(textPart).toBeDefined()
        expect((textPart as MessageV2.TextPart).text).toBe("[Injected from Sidekick]: test conclusion")

        await Session.remove(session.id)
      },
    })
  })
})

describe("sidekick isolation guards", () => {
  test("Session.fork rejects sidekick session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const sidekick = await Sidekick.ensure(session.id)

        await expect(Session.fork({ sessionID: sidekick.id })).rejects.toThrow("Cannot fork a sidekick session")

        await Session.remove(session.id)
      },
    })
  })

  test("Session.share rejects sidekick session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const sidekick = await Sidekick.ensure(session.id)

        await expect(Session.share(sidekick.id)).rejects.toThrow("Cannot share a sidekick session")

        await Session.remove(session.id)
      },
    })
  })

  test("Session.create rejects child of sidekick session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const sidekick = await Sidekick.ensure(session.id)

        await expect(Session.create({ parentID: sidekick.id })).rejects.toThrow(
          "Cannot create a child of a sidekick session",
        )

        await Session.remove(session.id)
      },
    })
  })
})

describe("sidekick cascade lifecycle", () => {
  test("Session.remove deletes sidekick child", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const parent = await Session.create({})
        const sidekick = await Sidekick.ensure(parent.id)

        await Session.remove(parent.id)

        await expect(Session.get(sidekick.id)).rejects.toThrow()
      },
    })
  })
})

describe("sidekick context guards", () => {
  test("context rejects sidekick as parent", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const sidekick = await Sidekick.ensure(session.id)

        await expect(Sidekick.context({ parentID: sidekick.id, limit: 30 })).rejects.toThrow(
          "Cannot build sidekick context from a sidekick session",
        )

        await Session.remove(session.id)
      },
    })
  })
})

describe("sidekick project isolation", () => {
  test("inject succeeds for same-project parent with user message", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Add a user message so inject can work normally
        const userMsgID = MessageID.ascending()
        await Session.updateMessage({
          id: userMsgID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)

        // Normal inject should work
        const msg = await Sidekick.inject({ parentID: session.id, text: "ok" })
        expect(msg.role).toBe("user")

        await Session.remove(session.id)
      },
    })
  })

  test("inject rejects cross-project parentID", async () => {
    // Create a session in project A
    let sessionID: string | undefined
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        sessionID = session.id
      },
    })

    // Try to inject from project B — different directory = different project
    const otherDir = os.tmpdir()
    await Instance.provide({
      directory: otherDir,
      fn: async () => {
        await expect(
          Sidekick.inject({ parentID: sessionID as any, text: "cross-project test" }),
        ).rejects.toThrow("different project")
      },
    })

    // Cleanup from original project context
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.remove(sessionID as any)
      },
    })
  })

  test("inject rejects sidekick as target", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const sidekick = await Sidekick.ensure(session.id)

        await expect(Sidekick.inject({ parentID: sidekick.id, text: "test" })).rejects.toThrow(
          "Cannot inject into a sidekick session",
        )

        await Session.remove(session.id)
      },
    })
  })
})
