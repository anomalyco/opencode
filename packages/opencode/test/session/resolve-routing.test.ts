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
import { MessageTable, PartTable, SessionTable, TodoTable } from "../../src/session/session.sql"
import { SyncEvent } from "../../src/sync"
import { initProjectors } from "../../src/server/projectors"
import { Log } from "../../src/util/log"

Log.init({ print: false })
initProjectors()

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

      await Session.remove(session.id)
      Database.closeSession(session.id)
    })
  })

  test("first write to a shard-less session triggers lazy migration on read", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const file = shardfile(session.id)

      await drop(session.id)

      expect(existsSync(file)).toBe(false)
      expect(Database.hasSession(session.id)).toBe(false)

      // Write via SyncEvent goes to global (sync layer uses sessionRoot, not ensureShard)
      const id = await msg(session.id, "lazy shard")

      // Read triggers resolveSession → ensureShard → migration
      const item = MessageV2.get({ sessionID: session.id, messageID: id })
      const shard = Database.session(session.id)
      const global = Database.Client()
      const in_shard = shard.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()
      const in_global = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, id)).get()

      expect(item.info.id).toBe(id)
      expect(item.parts).toMatchObject([
        { id: item.parts[0]?.id, messageID: id, sessionID: session.id, type: "text", text: "lazy shard" },
      ])
      expect(existsSync(file)).toBe(true)
      expect(in_shard?.id).toBe(id)
      // Global retains the copy (not deleted during migration)
      expect(in_global?.id).toBe(id)

      await Session.remove(session.id)
      Database.closeSession(session.id)
    })
  })

  test("lazy migration copies existing global data into the new shard", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const file = shardfile(session.id)

      // Write a message to the shard via normal path
      const old = await msg(session.id, "before migration")

      // Copy shard data into global DB to simulate pre-shard state
      const shard = Database.session(session.id)
      const global = Database.Client()
      const rows = shard.select().from(MessageTable).where(eq(MessageTable.session_id, session.id)).all()
      for (const row of rows) {
        global
          .insert(MessageTable)
          .values({ id: row.id, session_id: row.session_id, time_created: row.time_created, data: row.data })
          .run()
      }
      const parts = shard.select().from(PartTable).where(eq(PartTable.session_id, session.id)).all()
      for (const row of parts) {
        global
          .insert(PartTable)
          .values({
            id: row.id,
            message_id: row.message_id,
            session_id: row.session_id,
            time_created: row.time_created,
            data: row.data,
          })
          .run()
      }

      // Drop the shard so resolveSession falls through
      await drop(session.id)
      expect(existsSync(file)).toBe(false)

      // Confirm the old message is readable from the global fallback
      const before = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, old)).get()
      expect(before?.id).toBe(old)

      // Write a new todo — this triggers lazy migration
      await Todo.update({ sessionID: session.id, todos: [{ content: "post", status: "pending", priority: "high" }] })

      // Shard should now exist
      expect(existsSync(file)).toBe(true)

      // Old message should have been migrated into the shard
      const fresh = Database.session(session.id)
      const migrated = fresh.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, old)).get()
      expect(migrated?.id).toBe(old)

      // New todo should be in the shard
      const todos = fresh.select().from(TodoTable).where(eq(TodoTable.session_id, session.id)).all()
      expect(todos.length).toBe(1)
      expect(todos[0]?.content).toBe("post")

      // Global still has the old copy (not deleted during migration)
      const still = global.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.id, old)).get()
      expect(still?.id).toBe(old)

      await Session.remove(session.id)
      Database.closeSession(session.id)
    })
  })
})

describe("sweep marker", () => {
  test("seed writes marker, second ensureShard skips seed", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const sid = session.id

      // Write a message via Sync → goes to shard
      await msg(sid, "shard-msg")

      // Simulate orphan: insert directly into global
      const src = Database.Client().$client
      const now = Date.now()
      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), sid, now, now, JSON.stringify({ role: "user", text: "orphan" }))

      // First ensureShard: no marker → should seed
      Database.closeSession(sid)
      const db1 = Database.ensureShard(sid)
      expect(db1).toBe(sid)

      // Verify marker was written
      const shard = Database.session(sid).$client
      const mark = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:msg:${sid}`) as {
        value: string
      } | null
      const part = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:part:${sid}`) as {
        value: string
      } | null
      const todo = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:todo:${sid}`) as {
        value: string
      } | null
      expect(mark).not.toBeNull()
      expect(part).not.toBeNull()
      expect(todo).not.toBeNull()
      expect(Number(mark!.value)).toBeGreaterThan(0)
      expect(Number(part!.value)).toBe(0)
      expect(Number(todo!.value)).toBe(0)

      // Close and reopen to reset in-memory swept set
      Database.closeSession(sid)
      Database.resetSwept()

      // Second ensureShard: marker matches global MAX → should skip seed
      const before = performance.now()
      const db2 = Database.ensureShard(sid)
      const elapsed = performance.now() - before
      expect(db2).toBe(sid)
      // Should avoid an expensive re-seed on the same markers
      expect(elapsed).toBeLessThan(2_000)
    })
  })

  test("new orphan after sweep triggers re-seed", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const sid = session.id

      // Write initial message and trigger first sweep
      await msg(sid, "initial")
      const src = Database.Client().$client
      const now = Date.now()
      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), sid, now, now, JSON.stringify({ role: "user", text: "orphan-1" }))

      Database.closeSession(sid)
      Database.ensureShard(sid)

      // Verify orphan was copied to shard
      const shard1 = Database.session(sid)
      const count1 = shard1.select().from(MessageTable).where(eq(MessageTable.session_id, sid)).all().length
      expect(count1).toBe(2) // shard-msg + orphan-1

      // Now add ANOTHER orphan with a newer timestamp
      const later = now + 10000
      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), sid, later, later, JSON.stringify({ role: "user", text: "orphan-2" }))

      // Reset swept set to simulate process restart
      Database.closeSession(sid)
      Database.resetSwept()

      // ensureShard should detect stale marker and re-seed
      Database.ensureShard(sid)

      const shard2 = Database.session(sid)
      const count2 = shard2.select().from(MessageTable).where(eq(MessageTable.session_id, sid)).all().length
      expect(count2).toBe(3) // shard-msg + orphan-1 + orphan-2
    })
  })

  test("marker survives shard cache eviction", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const sid = session.id

      // Plant orphan and sweep
      const src = Database.Client().$client
      const now = Date.now()
      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), sid, now, now, JSON.stringify({ role: "user", text: "orphan" }))

      Database.ensureShard(sid)

      // Close the shard (simulates cache eviction)
      Database.closeSession(sid)
      Database.resetSwept()

      // Reopen — marker should still be in the sqlite file
      const shard = Database.session(sid).$client
      const mark = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:msg:${sid}`) as {
        value: string
      } | null
      const part = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:part:${sid}`) as {
        value: string
      } | null
      const todo = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:todo:${sid}`) as {
        value: string
      } | null
      expect(mark).not.toBeNull()
      expect(part).not.toBeNull()
      expect(todo).not.toBeNull()
      expect(Number(mark!.value)).toBe(now)
      expect(Number(part!.value)).toBe(0)
      expect(Number(todo!.value)).toBe(0)
    })
  })

  test("child session marker is independent of parent marker", async () => {
    await scope(async () => {
      const parent = await Session.create({})
      const child = await Session.create({ parentID: parent.id })
      const src = Database.Client().$client
      const now = Date.now()
      const later = now + 10000

      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), parent.id, now, now, JSON.stringify({ role: "user", text: "parent-orphan-1" }))
      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), child.id, now, now, JSON.stringify({ role: "user", text: "child-orphan-1" }))

      Database.closeSession(parent.id)
      Database.resetSwept()
      Database.ensureShard(child.id)

      let shard = Database.session(parent.id).$client
      const parent_before = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:msg:${parent.id}`) as {
        value: string
      } | null
      const child_before = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:msg:${child.id}`) as {
        value: string
      } | null

      expect(parent_before?.value).toBe(String(now))
      expect(child_before?.value).toBe(String(now))

      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), parent.id, later, later, JSON.stringify({ role: "user", text: "parent-orphan-2" }))

      Database.closeSession(parent.id)
      Database.ensureShard(parent.id)
      shard = Database.session(parent.id).$client

      const parent_after = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:msg:${parent.id}`) as {
        value: string
      } | null
      const child_after = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:msg:${child.id}`) as {
        value: string
      } | null

      expect(parent_after?.value).toBe(String(later))
      expect(child_after?.value).toBe(String(now))
    })
  })

  test("close clears swept gate so a reopened shard rechecks markers", async () => {
    await scope(async () => {
      const session = await Session.create({})
      const sid = session.id
      const now = Date.now()
      const later = now + 10000
      const row = Database.Client().select().from(SessionTable).where(eq(SessionTable.id, sid)).get()

      expect(row?.id).toBe(sid)

      Database.Client()
        .$client.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), sid, now, now, JSON.stringify({ role: "user", text: "orphan-1" }))

      Database.closeSession(sid)
      Database.resetSwept()
      Database.ensureShard(sid)

      Database.close()

      const src = Database.Client().$client
      src.exec("PRAGMA foreign_keys = OFF")
      Database.Client().insert(SessionTable).values(row!).onConflictDoNothing().run()
      src
        .query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
        .run(MessageID.ascending(), sid, later, later, JSON.stringify({ role: "user", text: "orphan-2" }))
      src.exec("PRAGMA foreign_keys = ON")

      Database.ensureShard(sid)

      const shard = Database.session(sid).$client
      const mark = shard.query("SELECT value FROM _meta WHERE key = ?").get(`swept:msg:${sid}`) as {
        value: string
      } | null
      const rows = Database.session(sid).select().from(MessageTable).where(eq(MessageTable.session_id, sid)).all()

      expect(mark?.value).toBe(String(later))
      expect(rows).toHaveLength(2)
    })
  })
})
