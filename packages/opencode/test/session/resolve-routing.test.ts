import { describe, expect, test } from "bun:test"
import path from "path"
import { existsSync, mkdirSync, unlinkSync, statSync } from "fs"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
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

  test("hasSession uses 8KB threshold for cold cache (after restart)", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const file = path.join(Database.sessionDir, session.id + ".db")

        // Close the session to clear it from cache
        Database.closeSession(session.id)

        // Cold cache: hasSession falls back to file size check
        // Fresh shard (schema only, 4KB) is under the 8KB threshold
        expect(statSync(file).size).toBeLessThanOrEqual(8192)
        expect(Database.hasSession(session.id)).toBe(false)

        // Re-open and write a message to grow the shard
        Database.session(session.id)
        await msg(session.id, "grow shard")
        Database.closeSession(session.id)

        // After writing, shard should be >8KB on cold cache check
        expect(Database.hasSession(session.id)).toBe(true)

        await Session.remove(session.id)
        Database.closeSession(session.id)
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
        const sessions: any[] = []
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
