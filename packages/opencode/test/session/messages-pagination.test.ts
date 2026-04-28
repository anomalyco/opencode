import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import * as Log from "@opencode-ai/core/util/log"

const root = path.join(__dirname, "../..")
void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  remove(id: SessionID) {
    return run(SessionNs.Service.use((svc) => svc.remove(id)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((svc) => svc.updatePart(part)))
  },
}

async function fill(sessionID: SessionID, count: number, time = (i: number) => Date.now() + i) {
  const ids = [] as MessageID[]
  for (let i = 0; i < count; i++) {
    const id = MessageID.ascending()
    ids.push(id)
    await svc.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created: time(i) },
      agent: "test",
      model: { providerID: "test", modelID: "test" },
      tools: {},
      mode: "",
    } as unknown as MessageV2.Info)
    await svc.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: id,
      type: "text",
      text: `m${i}`,
    })
  }
  return ids
}

async function addUser(sessionID: SessionID, text?: string) {
  const id = MessageID.ascending()
  await svc.updateMessage({
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  if (text) {
    await svc.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: id,
      type: "text",
      text,
    })
  }
  return id
}

async function addAssistant(
  sessionID: SessionID,
  parentID: MessageID,
  opts?: { summary?: boolean; finish?: string; error?: MessageV2.Assistant["error"] },
) {
  const id = MessageID.ascending()
  await svc.updateMessage({
    id,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID,
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    mode: "",
    agent: "default",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    summary: opts?.summary,
    finish: opts?.finish,
    error: opts?.error,
  } as unknown as MessageV2.Info)
  return id
}

async function addCompactionPart(sessionID: SessionID, messageID: MessageID, tailStartID?: MessageID) {
  await svc.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "compaction",
    auto: true,
    tail_start_id: tailStartID,
  } as any)
}

describe("MessageV2.page", () => {
  test("returns sync result", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        await fill(session.id, 2)

        const result = MessageV2.page({ sessionID: session.id, limit: 10 })
        expect(result).toBeDefined()
        expect(result.items).toBeArray()

        await svc.remove(session.id)
      },
    })
  })

  test("pages backward with opaque cursors", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 6)

        const a = MessageV2.page({ sessionID: session.id, limit: 2 })
        expect(a.items.map((item) => item.info.id)).toEqual(ids.slice(-2))
        expect(a.items.every((item) => item.parts.length === 1)).toBe(true)
        expect(a.more).toBe(true)
        expect(a.cursor).toBeTruthy()

        const b = MessageV2.page({ sessionID: session.id, limit: 2, before: a.cursor! })
        expect(b.items.map((item) => item.info.id)).toEqual(ids.slice(-4, -2))
        expect(b.more).toBe(true)
        expect(b.cursor).toBeTruthy()

        const c = MessageV2.page({ sessionID: session.id, limit: 2, before: b.cursor! })
        expect(c.items.map((item) => item.info.id)).toEqual(ids.slice(0, 2))
        expect(c.more).toBe(false)
        expect(c.cursor).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })

  test("returns items in chronological order within a page", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 4)

        const result = MessageV2.page({ sessionID: session.id, limit: 4 })
        expect(result.items.map((item) => item.info.id)).toEqual(ids)

        await svc.remove(session.id)
      },
    })
  })

  test("returns empty items for session with no messages", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const result = MessageV2.page({ sessionID: session.id, limit: 10 })
        expect(result.items).toEqual([])
        expect(result.more).toBe(false)
        expect(result.cursor).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })

  test("throws NotFoundError for non-existent session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const fake = "non-existent-session" as SessionID
        expect(() => MessageV2.page({ sessionID: fake, limit: 10 })).toThrow("NotFoundError")
      },
    })
  })

  test("handles exact limit boundary", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 3)

        const result = MessageV2.page({ sessionID: session.id, limit: 3 })
        expect(result.items.map((item) => item.info.id)).toEqual(ids)
        expect(result.more).toBe(false)
        expect(result.cursor).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })

  test("limit of 1 returns single newest message", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 5)

        const result = MessageV2.page({ sessionID: session.id, limit: 1 })
        expect(result.items).toHaveLength(1)
        expect(result.items[0].info.id).toBe(ids[ids.length - 1])
        expect(result.more).toBe(true)

        await svc.remove(session.id)
      },
    })
  })

  test("hydrates multiple parts per message", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const [id] = await fill(session.id, 1)

        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: id,
          type: "text",
          text: "extra",
        })

        const result = MessageV2.page({ sessionID: session.id, limit: 10 })
        expect(result.items).toHaveLength(1)
        expect(result.items[0].parts).toHaveLength(2)

        await svc.remove(session.id)
      },
    })
  })

  test("accepts cursors from fractional timestamps", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 4, (i) => 1000.5 + i)

        const a = MessageV2.page({ sessionID: session.id, limit: 2 })
        const b = MessageV2.page({ sessionID: session.id, limit: 2, before: a.cursor! })

        expect(a.items.map((item) => item.info.id)).toEqual(ids.slice(-2))
        expect(b.items.map((item) => item.info.id)).toEqual(ids.slice(0, 2))

        await svc.remove(session.id)
      },
    })
  })

  test("messages with same timestamp are ordered by id", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 4, () => 1000)

        const a = MessageV2.page({ sessionID: session.id, limit: 2 })
        expect(a.items.map((item) => item.info.id)).toEqual(ids.slice(-2))
        expect(a.more).toBe(true)

        const b = MessageV2.page({ sessionID: session.id, limit: 2, before: a.cursor! })
        expect(b.items.map((item) => item.info.id)).toEqual(ids.slice(0, 2))
        expect(b.more).toBe(false)

        await svc.remove(session.id)
      },
    })
  })

  test("does not return messages from other sessions", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const a = await svc.create({})
        const b = await svc.create({})
        await fill(a.id, 3)
        await fill(b.id, 2)

        const resultA = MessageV2.page({ sessionID: a.id, limit: 10 })
        const resultB = MessageV2.page({ sessionID: b.id, limit: 10 })
        expect(resultA.items).toHaveLength(3)
        expect(resultB.items).toHaveLength(2)
        expect(resultA.items.every((item) => item.info.sessionID === a.id)).toBe(true)
        expect(resultB.items.every((item) => item.info.sessionID === b.id)).toBe(true)

        await svc.remove(a.id)
        await svc.remove(b.id)
      },
    })
  })

  test("large limit returns all messages without cursor", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 10)

        const result = MessageV2.page({ sessionID: session.id, limit: 100 })
        expect(result.items).toHaveLength(10)
        expect(result.items.map((item) => item.info.id)).toEqual(ids)
        expect(result.more).toBe(false)
        expect(result.cursor).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })
})

describe("MessageV2.stream", () => {
  test("yields items newest first", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 5)

        const items = Array.from(MessageV2.stream(session.id))
        expect(items.map((item) => item.info.id)).toEqual(ids.slice().reverse())

        await svc.remove(session.id)
      },
    })
  })

  test("yields nothing for empty session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const items = Array.from(MessageV2.stream(session.id))
        expect(items).toHaveLength(0)

        await svc.remove(session.id)
      },
    })
  })

  test("yields single message", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 1)

        const items = Array.from(MessageV2.stream(session.id))
        expect(items).toHaveLength(1)
        expect(items[0].info.id).toBe(ids[0])

        await svc.remove(session.id)
      },
    })
  })

  test("hydrates parts for each yielded message", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        await fill(session.id, 3)

        const items = Array.from(MessageV2.stream(session.id))
        for (const item of items) {
          expect(item.parts).toHaveLength(1)
          expect(item.parts[0].type).toBe("text")
        }

        await svc.remove(session.id)
      },
    })
  })

  test("handles sets exceeding internal page size", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 60)

        const items = Array.from(MessageV2.stream(session.id))
        expect(items).toHaveLength(60)
        expect(items[0].info.id).toBe(ids[ids.length - 1])
        expect(items[59].info.id).toBe(ids[0])

        await svc.remove(session.id)
      },
    })
  })

  test("is a sync generator", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        await fill(session.id, 1)

        const gen = MessageV2.stream(session.id)
        const first = gen.next()
        // sync generator returns { value, done } directly, not a Promise
        expect(first).toHaveProperty("value")
        expect(first).toHaveProperty("done")
        expect(first.done).toBe(false)

        await svc.remove(session.id)
      },
    })
  })
})

describe("MessageV2.parts", () => {
  test("returns parts for a message", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const [id] = await fill(session.id, 1)

        const result = MessageV2.parts(id)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("text")
        expect((result[0] as MessageV2.TextPart).text).toBe("m0")

        await svc.remove(session.id)
      },
    })
  })

  test("returns empty array for message with no parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const id = await addUser(session.id)

        const result = MessageV2.parts(id)
        expect(result).toEqual([])

        await svc.remove(session.id)
      },
    })
  })

  test("returns multiple parts in order", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const [id] = await fill(session.id, 1)

        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: id,
          type: "text",
          text: "second",
        })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: id,
          type: "text",
          text: "third",
        })

        const result = MessageV2.parts(id)
        expect(result).toHaveLength(3)
        expect((result[0] as MessageV2.TextPart).text).toBe("m0")
        expect((result[1] as MessageV2.TextPart).text).toBe("second")
        expect((result[2] as MessageV2.TextPart).text).toBe("third")

        await svc.remove(session.id)
      },
    })
  })

  test("returns empty for non-existent message id", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        await svc.create({})
        const result = MessageV2.parts(MessageID.ascending())
        expect(result).toEqual([])
      },
    })
  })

  test("parts contain sessionID and messageID", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const [id] = await fill(session.id, 1)

        const result = MessageV2.parts(id)
        expect(result[0].sessionID).toBe(session.id)
        expect(result[0].messageID).toBe(id)

        await svc.remove(session.id)
      },
    })
  })
})

describe("MessageV2.get", () => {
  test("returns message with hydrated parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const [id] = await fill(session.id, 1)

        const result = MessageV2.get({ sessionID: session.id, messageID: id })
        expect(result.info.id).toBe(id)
        expect(result.info.sessionID).toBe(session.id)
        expect(result.info.role).toBe("user")
        expect(result.parts).toHaveLength(1)
        expect((result.parts[0] as MessageV2.TextPart).text).toBe("m0")

        await svc.remove(session.id)
      },
    })
  })

  test("throws NotFoundError for non-existent message", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        expect(() => MessageV2.get({ sessionID: session.id, messageID: MessageID.ascending() })).toThrow(
          "NotFoundError",
        )

        await svc.remove(session.id)
      },
    })
  })

  test("scopes by session id", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const a = await svc.create({})
        const b = await svc.create({})
        const [id] = await fill(a.id, 1)

        expect(() => MessageV2.get({ sessionID: b.id, messageID: id })).toThrow("NotFoundError")
        const result = MessageV2.get({ sessionID: a.id, messageID: id })
        expect(result.info.id).toBe(id)

        await svc.remove(a.id)
        await svc.remove(b.id)
      },
    })
  })

  test("returns message with multiple parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const [id] = await fill(session.id, 1)

        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: id,
          type: "text",
          text: "extra",
        })

        const result = MessageV2.get({ sessionID: session.id, messageID: id })
        expect(result.parts).toHaveLength(2)

        await svc.remove(session.id)
      },
    })
  })

  test("returns assistant message with correct role", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const uid = await addUser(session.id, "hello")
        const aid = await addAssistant(session.id, uid)

        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: aid,
          type: "text",
          text: "response",
        })

        const result = MessageV2.get({ sessionID: session.id, messageID: aid })
        expect(result.info.role).toBe("assistant")
        expect(result.parts).toHaveLength(1)
        expect((result.parts[0] as MessageV2.TextPart).text).toBe("response")

        await svc.remove(session.id)
      },
    })
  })

  test("returns message with zero parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const id = await addUser(session.id)

        const result = MessageV2.get({ sessionID: session.id, messageID: id })
        expect(result.info.id).toBe(id)
        expect(result.parts).toEqual([])

        await svc.remove(session.id)
      },
    })
  })
})

describe("MessageV2.filterCompacted", () => {
  test("returns all messages when no compaction", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const ids = await fill(session.id, 5)

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))
        expect(result).toHaveLength(5)
        // reversed from newest-first to chronological
        expect(result.map((item) => item.info.id)).toEqual(ids)

        await svc.remove(session.id)
      },
    })
  })

  test("stops at compaction boundary and returns chronological order", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        // Chronological: u1(+compaction part), a1(summary, parentID=u1), u2, a2
        // Stream (newest first): a2, u2, a1(adds u1 to completed), u1(in completed + compaction) -> break
        const u1 = await addUser(session.id, "first question")
        const a1 = await addAssistant(session.id, u1, { summary: true, finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a1,
          type: "text",
          text: "summary",
        })
        await addCompactionPart(session.id, u1)

        const u2 = await addUser(session.id, "new question")
        const a2 = await addAssistant(session.id, u2)
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a2,
          type: "text",
          text: "new response",
        })

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))
        // Includes compaction boundary: u1, a1, u2, a2
        expect(result[0].info.id).toBe(u1)
        expect(result.length).toBe(4)

        await svc.remove(session.id)
      },
    })
  })

  test("handles empty iterable", () => {
    const result = MessageV2.filterCompacted([])
    expect(result).toEqual([])
  })

  test("does not break on compaction part without matching summary", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const u1 = await addUser(session.id, "hello")
        await addCompactionPart(session.id, u1)
        await addUser(session.id, "world")

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))
        expect(result).toHaveLength(2)

        await svc.remove(session.id)
      },
    })
  })

  test("skips assistant with error even if marked as summary", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const u1 = await addUser(session.id, "hello")
        await addCompactionPart(session.id, u1)

        const error = new MessageV2.APIError({
          message: "boom",
          isRetryable: true,
        }).toObject() as MessageV2.Assistant["error"]
        await addAssistant(session.id, u1, { summary: true, finish: "end_turn", error })
        await addUser(session.id, "retry")

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))
        // Error assistant doesn't add to completed, so compaction boundary never triggers
        expect(result).toHaveLength(3)

        await svc.remove(session.id)
      },
    })
  })

  test("skips assistant without finish even if marked as summary", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const u1 = await addUser(session.id, "hello")
        await addCompactionPart(session.id, u1)

        // summary=true but no finish
        await addAssistant(session.id, u1, { summary: true })
        await addUser(session.id, "next")

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))
        expect(result).toHaveLength(3)

        await svc.remove(session.id)
      },
    })
  })

  test("retains original tail when compaction stores tail_start_id", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const u1 = await addUser(session.id, "first")
        const a1 = await addAssistant(session.id, u1, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a1,
          type: "text",
          text: "first reply",
        })

        const u2 = await addUser(session.id, "second")
        const a2 = await addAssistant(session.id, u2, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a2,
          type: "text",
          text: "second reply",
        })

        const c1 = await addUser(session.id)
        await addCompactionPart(session.id, c1, u2)
        const s1 = await addAssistant(session.id, c1, { summary: true, finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: s1,
          type: "text",
          text: "summary",
        })

        const u3 = await addUser(session.id, "third")
        const a3 = await addAssistant(session.id, u3, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a3,
          type: "text",
          text: "third reply",
        })

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))

        expect(result.map((item) => item.info.id)).toEqual([u2, a2, c1, s1, u3, a3])

        await svc.remove(session.id)
      },
    })
  })

  test("retains an assistant tail when compaction starts inside a turn", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const u1 = await addUser(session.id, "first")
        const a1 = await addAssistant(session.id, u1, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a1,
          type: "text",
          text: "first reply",
        })

        const u2 = await addUser(session.id, "second")
        const a2 = await addAssistant(session.id, u2, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a2,
          type: "text",
          text: "second reply",
        })
        const a3 = await addAssistant(session.id, u2, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a3,
          type: "text",
          text: "tail reply",
        })

        const c1 = await addUser(session.id)
        await addCompactionPart(session.id, c1, a3)
        const s1 = await addAssistant(session.id, c1, { summary: true, finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: s1,
          type: "text",
          text: "summary",
        })

        const u3 = await addUser(session.id, "third")
        const a4 = await addAssistant(session.id, u3, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a4,
          type: "text",
          text: "third reply",
        })

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))

        expect(result.map((item) => item.info.id)).toEqual([a3, c1, s1, u3, a4])

        await svc.remove(session.id)
      },
    })
  })

  test("prefers latest compaction boundary when repeated compactions exist", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const u1 = await addUser(session.id, "first")
        const a1 = await addAssistant(session.id, u1, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a1,
          type: "text",
          text: "first reply",
        })

        const u2 = await addUser(session.id, "second")
        const a2 = await addAssistant(session.id, u2, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a2,
          type: "text",
          text: "second reply",
        })

        const c1 = await addUser(session.id)
        await addCompactionPart(session.id, c1, u2)
        const s1 = await addAssistant(session.id, c1, { summary: true, finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: s1,
          type: "text",
          text: "summary one",
        })

        const u3 = await addUser(session.id, "third")
        const a3 = await addAssistant(session.id, u3, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a3,
          type: "text",
          text: "third reply",
        })

        const c2 = await addUser(session.id)
        await addCompactionPart(session.id, c2, u3)
        const s2 = await addAssistant(session.id, c2, { summary: true, finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: s2,
          type: "text",
          text: "summary two",
        })

        const u4 = await addUser(session.id, "fourth")
        const a4 = await addAssistant(session.id, u4, { finish: "end_turn" })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: a4,
          type: "text",
          text: "fourth reply",
        })

        const result = MessageV2.filterCompacted(MessageV2.stream(session.id))

        expect(result.map((item) => item.info.id)).toEqual([u3, a3, c2, s2, u4, a4])

        await svc.remove(session.id)
      },
    })
  })

  test("works with array input", () => {
    // filterCompacted accepts any Iterable, not just generators
    const id = MessageID.ascending()
    const items: MessageV2.WithParts[] = [
      {
        info: {
          id,
          sessionID: "s1",
          role: "user",
          time: { created: 1 },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
        } as unknown as MessageV2.Info,
        parts: [{ type: "text", text: "hello" }] as unknown as MessageV2.Part[],
      },
    ]
    const result = MessageV2.filterCompacted(items)
    expect(result).toHaveLength(1)
    expect(result[0].info.id).toBe(id)
  })
})

describe("MessageV2.cursor", () => {
  test("encode/decode roundtrip", () => {
    const input = { id: MessageID.ascending(), time: 1234567890 }
    const encoded = MessageV2.cursor.encode(input)
    const decoded = MessageV2.cursor.decode(encoded)
    expect(decoded.id).toBe(input.id)
    expect(decoded.time).toBe(input.time)
  })

  test("encode/decode with fractional time", () => {
    const input = { id: MessageID.ascending(), time: 1234567890.5 }
    const encoded = MessageV2.cursor.encode(input)
    const decoded = MessageV2.cursor.decode(encoded)
    expect(decoded.time).toBe(1234567890.5)
  })

  test("encoded cursor is base64url", () => {
    const encoded = MessageV2.cursor.encode({ id: MessageID.ascending(), time: 0 })
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe("MessageV2 consistency", () => {
  test("page hydration matches get for each message", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        await fill(session.id, 3)

        const paged = MessageV2.page({ sessionID: session.id, limit: 10 })
        for (const item of paged.items) {
          const got = MessageV2.get({ sessionID: session.id, messageID: item.info.id as MessageID })
          expect(got.info).toEqual(item.info)
          expect(got.parts).toEqual(item.parts)
        }

        await svc.remove(session.id)
      },
    })
  })

  test("parts from get match standalone parts call", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const [id] = await fill(session.id, 1)

        const got = MessageV2.get({ sessionID: session.id, messageID: id })
        const standalone = MessageV2.parts(id)
        expect(got.parts).toEqual(standalone)

        await svc.remove(session.id)
      },
    })
  })

  test("stream collects same messages as exhaustive page iteration", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        await fill(session.id, 7)

        const streamed = Array.from(MessageV2.stream(session.id))

        const paged = [] as MessageV2.WithParts[]
        let cursor: string | undefined
        while (true) {
          const result = MessageV2.page({ sessionID: session.id, limit: 3, before: cursor })
          for (let i = result.items.length - 1; i >= 0; i--) {
            paged.push(result.items[i])
          }
          if (!result.more || !result.cursor) break
          cursor = result.cursor
        }

        expect(streamed.map((m) => m.info.id)).toEqual(paged.map((m) => m.info.id))

        await svc.remove(session.id)
      },
    })
  })

  test("filterCompacted of full stream returns same as Array.from when no compaction", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        await fill(session.id, 4)

        const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
        const all = Array.from(MessageV2.stream(session.id)).reverse()

        expect(filtered.map((m) => m.info.id)).toEqual(all.map((m) => m.info.id))

        await svc.remove(session.id)
      },
    })
  })
})
