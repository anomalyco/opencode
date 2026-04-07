import { describe, expect, test } from "bun:test"
import path from "path"
import { existsSync, mkdirSync, unlinkSync, statSync } from "fs"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Todo } from "../../src/session/todo"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { MessageTable, TodoTable } from "../../src/session/session.sql"
import { SyncEvent } from "../../src/sync"
import { Log } from "../../src/util/log"

const repo = path.join(__dirname, "../../../..")
Log.init({ print: false })

async function scope(fn: () => Promise<void>) {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        await fn()
      } finally {
        await Instance.disposeAll()
        Database.close()
      }
    },
  })
}

function shardfile(id: SessionID) {
  return path.join(Database.sessionDir, id + ".db")
}

async function unlink(file: string) {
  for (let i = 0; i < 100; i++) {
    if (!existsSync(file)) return
    try {
      unlinkSync(file)
      return
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined
      if ((code !== "EBUSY" && code !== "EPERM") || i === 19) throw err
      await Bun.sleep(50)
    }
  }
}

async function drop(id: SessionID) {
  Database.closeSession(id)
  for (const ext of [".db", ".db-shm", ".db-wal"]) {
    await unlink(path.join(Database.sessionDir, id + ext))
  }
}

async function save(name: string, lines: string[]) {
  const dir = path.join(repo, ".sisyphus/evidence")
  mkdirSync(dir, { recursive: true })
  await Bun.write(path.join(dir, name), lines.join("\n") + "\n")
}

async function msg(sid: SessionID, text: string) {
  const id = MessageID.ascending()
  const info: MessageV2.User = {
    id,
    sessionID: sid,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    tools: {},
  }
  const part: MessageV2.TextPart = {
    id: PartID.ascending(),
    sessionID: info.sessionID,
    messageID: id,
    type: "text",
    text,
  }
  SyncEvent.run(MessageV2.Event.Updated, { sessionID: sid, info })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: sid, part, time: Date.now() })
  return id
}

describe("resolve() routing", () => {
  test("message updates stay readable from a sharded session", async () => {
    await scope(async () => {
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
    })
  })

  test("message updates re-resolve from the shard after Database.close()", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const file = shardfile(session.id)
      const id = await msg(session.id, "cold cache")

      expect(existsSync(file)).toBe(true)

      await Instance.disposeAll()
      Database.close()
      expect(Database.hasSession(session.id)).toBe(true)

      const item = MessageV2.get({ sessionID: session.id, messageID: id })
      expect(item.info.id).toBe(id)
      expect(item.parts).toMatchObject([
        { id: item.parts[0]?.id, messageID: id, sessionID: session.id, type: "text", text: "cold cache" },
      ])

      const shard = Database.session(session.id)
      const global = Database.Client()
      const in_shard = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
      const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()

      expect(in_shard?.id).toBe(id)
      expect(in_global).toBeUndefined()

      await save("task-2-cold-cache.txt", [
        "scenario: cold-cache recovery",
        `session: ${session.id}`,
        `message: ${id}`,
        `file: ${file}`,
        `has_session: ${Database.hasSession(session.id)}`,
        `shard_message: ${in_shard?.id ?? "missing"}`,
        `global_message: ${in_global?.id ?? "missing"}`,
      ])
    })
  })

  test("hasSession returns true when session is in cache", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const file = shardfile(session.id)
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
    })
  })

  test("hasSession accepts a schema-only shard after cold cache", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const file = shardfile(session.id)

      // Close the session to clear it from cache
      Database.closeSession(session.id)

      expect(statSync(file).size).toBeGreaterThan(0)
      expect(Database.hasSession(session.id)).toBe(true)

      await Session.remove(session.id)
      Database.closeSession(session.id)
    })
  })

  test("child sessions without a dedicated shard route through the root shard", async () => {
    await scope(async () => {
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
    })
  })

  test("sessionRoot returns undefined when a parent row is missing", async () => {
    await scope(async () => {
      const parent = await Session.create({})
      const child = await Session.create({ parentID: parent.id })
      const db = Database.Client().$client
      const file = shardfile(parent.id)

      await drop(parent.id)
      await drop(child.id)
      db.query("DELETE FROM session WHERE id = ?").run(parent.id)

      expect(Database.sessionRoot(child.id)).toBeUndefined()

      await Session.remove(child.id)
    })
  })

  test("sessionRoot returns undefined for cyclic parent chains", async () => {
    await scope(async () => {
      const parent = await Session.create({})
      const child = await Session.create({ parentID: parent.id })
      const db = Database.Client().$client
      const file = shardfile(parent.id)

      await drop(parent.id)
      await drop(child.id)
      db.query("UPDATE session SET parent_id = ? WHERE id = ?").run(child.id, parent.id)

      expect(Database.sessionRoot(child.id)).toBeUndefined()

      db.query("UPDATE session SET parent_id = NULL WHERE id = ?").run(parent.id)
      await Session.remove(parent.id)
    })
  })

  test("session list comes from the global DB regardless of shards", async () => {
    await scope(async () => {
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
    })
  })

  test("hasSession returns false for empty/malformed shard files", async () => {
    await scope(async () => {
      const id = "test-malformed-shard"
      mkdirSync(Database.sessionDir, { recursive: true })
      const file = shardfile(id as SessionID)

      // Create an empty file (simulates the bug that created 4KB empty shards)
      await Bun.write(file, "")
      expect(existsSync(file)).toBe(true)
      expect(Database.hasSession(id)).toBe(false)

      await unlink(file)
    })
  })

  test("message writes roundtrip immediately through the shard", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const id = await msg(session.id, "immediate shard read")
      const item = MessageV2.get({ sessionID: session.id, messageID: id })
      const shard = Database.session(session.id)
      const global = Database.Client()
      const in_shard = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
      const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()

      expect(item.info.id).toBe(id)
      expect(item.parts).toMatchObject([
        { id: item.parts[0]?.id, messageID: id, sessionID: session.id, type: "text", text: "immediate shard read" },
      ])
      expect(in_shard?.id).toBe(id)
      expect(in_global).toBeUndefined()

      await save("task-2-write-read-consistency.txt", [
        "scenario: sharded message write-read consistency",
        `session: ${session.id}`,
        `message: ${id}`,
        `parts: ${item.parts.length}`,
        `read_text: ${(item.parts[0] && "text" in item.parts[0] && item.parts[0].text) || ""}`,
        `shard_message: ${in_shard?.id ?? "missing"}`,
        `global_message: ${in_global?.id ?? "missing"}`,
      ])

      await Session.remove(session.id)
      Database.closeSession(session.id)
    })
  })

  test("todo updates roundtrip through the shard", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const todos = [
        { content: "one", status: "pending", priority: "high" },
        { content: "two", status: "completed", priority: "low" },
      ] satisfies Todo.Info[]

      await Todo.update({ sessionID: session.id, todos })
      const item = await Todo.get(session.id)
      const shard = Database.session(session.id)
      const global = Database.Client()
      const in_shard = shard
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, session.id))
        .orderBy(TodoTable.position)
        .all()
      const in_global = global
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, session.id))
        .orderBy(TodoTable.position)
        .all()

      expect(item).toEqual(todos)
      expect(in_shard.map((row) => ({ content: row.content, status: row.status, priority: row.priority }))).toEqual(
        todos,
      )
      expect(in_global).toEqual([])

      await save("task-2-todo-consistency.txt", [
        "scenario: todo write-read consistency",
        `session: ${session.id}`,
        `todos: ${JSON.stringify(item)}`,
        `shard_rows: ${in_shard.length}`,
        `global_rows: ${in_global.length}`,
      ])

      await Session.remove(session.id)
      Database.closeSession(session.id)
    })
  })

  test("sessions without shards keep message writes on the global DB", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const file = shardfile(session.id)

      await drop(session.id)

      expect(existsSync(file)).toBe(false)
      expect(Database.hasSession(session.id)).toBe(false)

      const id = await msg(session.id, "global only")
      const item = MessageV2.get({ sessionID: session.id, messageID: id })
      const global = Database.Client()
      const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()

      expect(item.info.id).toBe(id)
      expect(item.parts).toMatchObject([
        { id: item.parts[0]?.id, messageID: id, sessionID: session.id, type: "text", text: "global only" },
      ])
      expect(in_global?.id).toBe(id)
      expect(existsSync(file)).toBe(false)

      await save("task-2-non-sharded-consistency.txt", [
        "scenario: non-sharded session uses global db",
        `session: ${session.id}`,
        `message: ${id}`,
        `shard_file: ${existsSync(file)}`,
        `has_session: ${Database.hasSession(session.id)}`,
        `global_message: ${in_global?.id ?? "missing"}`,
      ])

      await Session.remove(session.id)
    })
  })
})
