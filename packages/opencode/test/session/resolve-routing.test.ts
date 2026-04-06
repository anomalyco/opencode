import { describe, expect, test } from "bun:test"
import path from "path"
import { existsSync, mkdirSync, unlinkSync, statSync } from "fs"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { MessageTable } from "../../src/session/session.sql"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

async function msg(sid: SessionID, text: string) {
  const id = MessageID.ascending()
  await Session.updateMessage({
    id,
    sessionID: sid,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: sid,
    messageID: id,
    type: "text",
    text,
  })
  return id
}

describe("resolve() routing", () => {
  test("message updates stay readable from a sharded session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const id = await msg(session.id, "route to shard")

        expect(Database.hasSession(session.id)).toBe(true)

        const item = MessageV2.get({ sessionID: session.id, messageID: id })
        expect(item.info.id).toBe(id)

        const shard = Database.session(session.id)
        const global = Database.Client()
        const in_shard = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
        const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()

        expect(in_shard?.id).toBe(id)
        expect(in_global).toBeUndefined()

        await Session.remove(session.id)
        Database.closeSession(session.id)
      },
    })
  })

  test("message updates stay in the root shard after cold cache", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        Database.closeSession(session.id)
        expect(Database.hasSession(session.id)).toBe(true)

        const id = await msg(session.id, "route to shard")
        const item = MessageV2.get({ sessionID: session.id, messageID: id })
        expect(item.info.id).toBe(id)

        const shard = Database.session(session.id)
        const global = Database.Client()
        const in_shard = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
        const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()

        expect(in_shard?.id).toBe(id)
        expect(in_global).toBeUndefined()

        await Session.remove(session.id)
        Database.closeSession(session.id)
      },
    })
  })

  test("hasSession returns true when session is in cache", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const file = path.join(Database.sessionDir, session.id + ".db")
        expect(existsSync(file)).toBe(true)

        // Session.create() calls Database.session() which adds to cache
        // hasSession returns true from cache hit
        expect(Database.hasSession(session.id)).toBe(true)

        // Database.session() returns the shard, not the global DB
        const shard = Database.session(session.id)
        const global = Database.Client()
        expect(shard).not.toBe(global)

        await Session.remove(session.id)
        Database.closeSession(session.id)
      },
    })
  })

  test("hasSession accepts a schema-only shard after cold cache", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const file = path.join(Database.sessionDir, session.id + ".db")

        // Close the session to clear it from cache
        Database.closeSession(session.id)

        expect(statSync(file).size).toBeGreaterThan(0)
        expect(Database.hasSession(session.id)).toBe(true)

        await Session.remove(session.id)
        Database.closeSession(session.id)
      },
    })
  })

  test("child sessions without a dedicated shard route through the root shard", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        Database.closeSession(parent.id)
        Database.closeSession(child.id)

        expect(Database.hasSession(parent.id)).toBe(true)
        expect(Database.hasSession(child.id)).toBe(false)
        expect(Database.sessionRoot(parent.id)).toBe(parent.id)
        expect(Database.sessionRoot(child.id)).toBe(parent.id)
        expect(Database.sessionRoot("ses_missing_root")).toBeUndefined()

        const id = await msg(child.id, "child routes to root shard")
        const item = MessageV2.get({ sessionID: child.id, messageID: id })
        expect(item.info.id).toBe(id)

        const shard = Database.session(parent.id)
        const global = Database.Client()
        const in_shard = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
        const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()

        expect(in_shard?.id).toBe(id)
        expect(in_global).toBeUndefined()

        await Session.remove(parent.id)
        Database.closeSession(parent.id)
        Database.closeSession(child.id)
      },
    })
  })

  test("sessionRoot returns undefined when a parent row is missing", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const db = Database.Client().$client
        const file = path.join(Database.sessionDir, parent.id + ".db")

        Database.closeSession(parent.id)
        Database.closeSession(child.id)
        if (existsSync(file)) unlinkSync(file)
        db.query("DELETE FROM session WHERE id = ?").run(parent.id)

        expect(Database.sessionRoot(child.id)).toBeUndefined()

        await Session.remove(child.id)
      },
    })
  })

  test("sessionRoot returns undefined for cyclic parent chains", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const db = Database.Client().$client
        const file = path.join(Database.sessionDir, parent.id + ".db")

        Database.closeSession(parent.id)
        Database.closeSession(child.id)
        if (existsSync(file)) unlinkSync(file)
        db.query("UPDATE session SET parent_id = ? WHERE id = ?").run(child.id, parent.id)

        expect(Database.sessionRoot(child.id)).toBeUndefined()

        db.query("UPDATE session SET parent_id = NULL WHERE id = ?").run(parent.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("session list comes from the global DB regardless of shards", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})

        // Write a message to grow the shard
        await msg(session.id, "list test")
        expect(Database.hasSession(session.id)).toBe(true)

        // Session should appear in the list (queried from global DB metadata)
        const sessions: Session.Info[] = []
        for await (const s of Session.list({})) {
          if (s.id === session.id) sessions.push(s)
        }
        expect(sessions.length).toBe(1)

        await Session.remove(session.id)
        Database.closeSession(session.id)
      },
    })
  })

  test("hasSession returns false for empty/malformed shard files", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const id = "test-malformed-shard"
        mkdirSync(Database.sessionDir, { recursive: true })
        const file = path.join(Database.sessionDir, id + ".db")

        // Create an empty file (simulates the bug that created 4KB empty shards)
        await Bun.write(file, "")
        expect(existsSync(file)).toBe(true)
        expect(Database.hasSession(id)).toBe(false)

        unlinkSync(file)
      },
    })
  })
})
