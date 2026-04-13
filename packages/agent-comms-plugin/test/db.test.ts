import { describe, it, expect, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import {
  initDb,
  getRegistry,
  upsertRegistry,
  deleteRegistry,
  isSubSession,
  updateLastAgent,
  syncSubSessionFlags,
  insertMessage,
  insertMessages,
  getMessages,
  markRead,
  markOrphaned,
  getUnreadCount,
  getUnreadSummary,
  getPendingMessages,
  incrementRetryCount,
  getConversation,
  upsertConversation,
  purgeExpired,
  getBroadcastCount,
  type MessageInput,
} from "../src/db"

let db: Database

function msg(overrides: Partial<MessageInput> = {}): MessageInput {
  return {
    conversation_id: "conv1",
    from_session: "sess_a",
    to_session: "sess_b",
    content: "hello",
    timestamp: Date.now(),
    read: 0,
    reply_to: null,
    depth: 0,
    type: "message",
    status: "delivered",
    retry_count: 0,
    ttl: Date.now() + 86400000,
    ...overrides,
  }
}

beforeEach(() => {
  db = initDb(":memory:")
})

describe("initDb", () => {
  it("creates database with correct schema", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
      name: string
    }>
    const names = tables.map((t) => t.name)
    expect(names).toContain("messages")
    expect(names).toContain("registry")
    expect(names).toContain("conversations")
  })

  it("sets WAL mode", () => {
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    expect(["wal", "memory"]).toContain(row.journal_mode)
  })

  it("sets read_uncommitted", () => {
    const row = db.prepare("PRAGMA read_uncommitted").get() as { read_uncommitted: number }
    expect(row.read_uncommitted).toBe(1)
  })

  it("is idempotent", () => {
    expect(() => initDb(":memory:")).not.toThrow()
  })
})

describe("registry", () => {
  it("upsertRegistry inserts new entry", () => {
    upsertRegistry(db, "sess1", { last_active: 1000 })
    const entry = getRegistry(db, "sess1")
    expect(entry).toBeDefined()
    expect(entry!.session_id).toBe("sess1")
    expect(entry!.last_active).toBe(1000)
  })

  it("upsertRegistry updates existing entry", () => {
    upsertRegistry(db, "sess1", { status: "available", last_active: 1000 })
    upsertRegistry(db, "sess1", { status: "busy", last_active: 2000 })
    const entry = getRegistry(db, "sess1")
    expect(entry!.status).toBe("busy")
    expect(entry!.last_active).toBe(2000)
  })

  it("getRegistry returns undefined for missing session", () => {
    expect(getRegistry(db, "nonexistent")).toBeFalsy()
  })

  it("deleteRegistry removes entry", () => {
    upsertRegistry(db, "sess1", { last_active: 1000 })
    deleteRegistry(db, "sess1")
    expect(getRegistry(db, "sess1")).toBeFalsy()
  })

  it("isSubSession returns true when is_subsession=1", () => {
    upsertRegistry(db, "sess1", { is_subsession: 1, last_active: 1000 })
    expect(isSubSession(db, "sess1")).toBe(true)
  })

  it("isSubSession returns false when is_subsession=0", () => {
    upsertRegistry(db, "sess1", { is_subsession: 0, last_active: 1000 })
    expect(isSubSession(db, "sess1")).toBe(false)
  })

  it("isSubSession returns false for missing session", () => {
    expect(isSubSession(db, "nonexistent")).toBe(false)
  })

  it("updateLastAgent updates last_agent field", () => {
    upsertRegistry(db, "sess1", { last_active: 1000 })
    updateLastAgent(db, "sess1", "build")
    expect(getRegistry(db, "sess1")!.last_agent).toBe("build")
  })

  it("syncSubSessionFlags batch updates", () => {
    syncSubSessionFlags(db, [
      { id: "sess1", hasParent: false },
      { id: "sess2", hasParent: true },
    ])
    expect(isSubSession(db, "sess1")).toBe(false)
    expect(isSubSession(db, "sess2")).toBe(true)
  })
})

describe("messages", () => {
  it("insertMessage inserts a message record", () => {
    const id = insertMessage(db, msg())
    expect(id).toBeGreaterThan(0)
  })

  it("insertMessages batch inserts in transaction", () => {
    insertMessages(db, [msg({ content: "a" }), msg({ content: "b" }), msg({ content: "c" })])
    const all = getMessages(db, {})
    expect(all.length).toBe(3)
  })

  it("getMessages filters by to_session", () => {
    insertMessage(db, msg({ to_session: "sess_b" }))
    insertMessage(db, msg({ to_session: "sess_c" }))
    const result = getMessages(db, { to_session: "sess_b" })
    expect(result.length).toBe(1)
    expect(result[0].to_session).toBe("sess_b")
  })

  it("getMessages filters by from_session", () => {
    insertMessage(db, msg({ from_session: "sess_a" }))
    insertMessage(db, msg({ from_session: "sess_x" }))
    expect(getMessages(db, { from_session: "sess_a" }).length).toBe(1)
  })

  it("getMessages filters by unread_only", () => {
    insertMessage(db, msg({ read: 0 }))
    insertMessage(db, msg({ read: 1 }))
    expect(getMessages(db, { unread_only: true }).length).toBe(1)
  })

  it("getMessages filters by conversation_id", () => {
    insertMessage(db, msg({ conversation_id: "conv1" }))
    insertMessage(db, msg({ conversation_id: "conv2" }))
    expect(getMessages(db, { conversation_id: "conv1" }).length).toBe(1)
  })

  it("getMessages filters by type", () => {
    insertMessage(db, msg({ type: "message" }))
    insertMessage(db, msg({ type: "response" }))
    expect(getMessages(db, { type: "response" }).length).toBe(1)
  })

  it("getMessages excludes by status", () => {
    insertMessage(db, msg({ status: "delivered" }))
    insertMessage(db, msg({ status: "orphaned" }))
    expect(getMessages(db, { status_exclude: ["orphaned"] }).length).toBe(1)
  })

  it("getMessages respects limit", () => {
    for (let i = 0; i < 5; i++) insertMessage(db, msg({ content: `msg_${i}` }))
    expect(getMessages(db, { limit: 3 }).length).toBe(3)
  })

  it("getMessages orders by timestamp DESC", () => {
    insertMessage(db, msg({ content: "first", timestamp: 1000 }))
    insertMessage(db, msg({ content: "second", timestamp: 2000 }))
    const result = getMessages(db, {})
    expect(result[0].content).toBe("second")
    expect(result[1].content).toBe("first")
  })

  it("markRead marks messages as read", () => {
    const id1 = insertMessage(db, msg({ read: 0 }))
    const id2 = insertMessage(db, msg({ read: 0 }))
    markRead(db, [id1, id2])
    expect(getMessages(db, { unread_only: true }).length).toBe(0)
  })

  it("markOrphaned marks messages for a session", () => {
    insertMessage(db, msg({ to_session: "sess_b" }))
    insertMessage(db, msg({ from_session: "sess_b", to_session: "sess_a" }))
    insertMessage(db, msg({ to_session: "sess_c" }))
    markOrphaned(db, "sess_b")
    const orphaned = getMessages(db, { status_exclude: ["orphaned"] })
    expect(orphaned.length).toBe(1)
    expect(orphaned[0].to_session).toBe("sess_c")
  })

  it("getUnreadCount returns count of unread messages", () => {
    insertMessage(db, msg({ to_session: "sess_b", read: 0 }))
    insertMessage(db, msg({ to_session: "sess_b", read: 0 }))
    insertMessage(db, msg({ to_session: "sess_b", read: 1 }))
    insertMessage(db, msg({ to_session: "sess_b", read: 0, status: "orphaned" }))
    expect(getUnreadCount(db, "sess_b")).toBe(2)
  })

  it("getUnreadSummary groups by sender and conversation", () => {
    insertMessage(db, msg({ from_session: "a", conversation_id: "c1", to_session: "me" }))
    insertMessage(db, msg({ from_session: "a", conversation_id: "c1", to_session: "me" }))
    insertMessage(db, msg({ from_session: "b", conversation_id: "c2", to_session: "me" }))
    const summary = getUnreadSummary(db, "me")
    expect(summary.length).toBe(2)
    expect(summary.find((s) => s.from_session === "a")!.count).toBe(2)
    expect(summary.find((s) => s.from_session === "b")!.count).toBe(1)
  })

  it("getPendingMessages returns messages with status pending", () => {
    insertMessage(db, msg({ to_session: "sess_b", status: "pending" }))
    insertMessage(db, msg({ to_session: "sess_b", status: "delivered" }))
    expect(getPendingMessages(db, "sess_b").length).toBe(1)
  })

  it("incrementRetryCount increments retry_count", () => {
    const id = insertMessage(db, msg({ retry_count: 0 }))
    incrementRetryCount(db, id)
    const row = getMessages(db, {}).find((m) => m.id === id)
    expect(row!.retry_count).toBe(1)
  })
})

describe("conversations", () => {
  it("upsertConversation inserts new conversation", () => {
    upsertConversation(db, "conv1", ["sess_a", "sess_b"])
    const conv = getConversation(db, "conv1")
    expect(conv).toBeDefined()
    expect(conv!.id).toBe("conv1")
    expect(JSON.parse(conv!.participants)).toEqual(["sess_a", "sess_b"])
  })

  it("upsertConversation updates existing conversation", () => {
    upsertConversation(db, "conv1", ["sess_a"])
    upsertConversation(db, "conv1", ["sess_a", "sess_b", "sess_c"])
    const conv = getConversation(db, "conv1")
    expect(JSON.parse(conv!.participants).length).toBe(3)
  })

  it("getConversation returns undefined for missing id", () => {
    expect(getConversation(db, "nonexistent")).toBeFalsy()
  })
})

describe("cleanup", () => {
  it("purgeExpired removes messages past TTL", () => {
    insertMessage(db, msg({ ttl: Date.now() - 1000 }))
    insertMessage(db, msg({ ttl: Date.now() + 86400000 }))
    const deleted = purgeExpired(db)
    expect(deleted).toBe(1)
    expect(getMessages(db, {}).length).toBe(1)
  })

  it("getBroadcastCount counts broadcasts in time window", () => {
    const now = Date.now()
    insertMessage(db, msg({ type: "broadcast", conversation_id: "b1", timestamp: now - 1000 }))
    insertMessage(db, msg({ type: "broadcast", conversation_id: "b1", timestamp: now - 500 }))
    insertMessage(db, msg({ type: "broadcast", conversation_id: "b2", timestamp: now - 200 }))
    expect(getBroadcastCount(db, now - 5000)).toBe(2)
  })

  it("getBroadcastCount returns 0 when no broadcasts in window", () => {
    expect(getBroadcastCount(db, Date.now())).toBe(0)
  })
})
