import { describe, it, expect } from "bun:test"
import { createSessionReadTool } from "../../src/tools/session-read"
import { initDb, insertMessage, upsertRegistry } from "../../src/db"
import type { Database } from "bun:sqlite"

function makeCtx(overrides?: Record<string, unknown>) {
  return {
    sessionID: "self_sess",
    messageID: "m1",
    agent: "build",
    directory: "/project",
    worktree: "/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ...overrides,
  }
}

function insertMsg(
  db: Database,
  overrides: Partial<{
    conversation_id: string
    from_session: string
    to_session: string
    content: string
    timestamp: number
    read: number
    depth: number
    type: string
    status: string
    ttl: number
  }> = {},
) {
  const now = Date.now()
  insertMessage(db, {
    conversation_id: overrides.conversation_id ?? "conv1",
    from_session: overrides.from_session ?? "other_sess",
    to_session: overrides.to_session ?? "self_sess",
    content: overrides.content ?? "hello",
    timestamp: overrides.timestamp ?? now,
    read: overrides.read ?? 0,
    reply_to: null,
    depth: overrides.depth ?? 0,
    type: overrides.type ?? "message",
    status: overrides.status ?? "delivered",
    retry_count: 0,
    ttl: overrides.ttl ?? now + 86400000,
  })
}

describe("session_read tool", () => {
  let db: Database

  function setup() {
    db = initDb(":memory:")
    upsertRegistry(db, "other_sess", { last_agent: "build", last_active: Date.now(), current_depth: 1 })
    upsertRegistry(db, "self_sess", { last_agent: "build", last_active: Date.now() })
  }

  it("returns unread messages for current session", async () => {
    setup()
    insertMsg(db, { content: "msg1" })
    insertMsg(db, { content: "msg2" })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({}, makeCtx() as any)
    expect(result).toContain("msg1")
    expect(result).toContain("msg2")
  })

  it("filters by from_session", async () => {
    setup()
    insertMsg(db, { from_session: "sess_a", content: "from A" })
    insertMsg(db, { from_session: "sess_b", content: "from B" })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({ from_session: "sess_a" }, makeCtx() as any)
    expect(result).toContain("from A")
    expect(result).not.toContain("from B")
  })

  it("filters by conversation_id", async () => {
    setup()
    insertMsg(db, { conversation_id: "conv1", content: "in conv1" })
    insertMsg(db, { conversation_id: "conv2", content: "in conv2" })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({ conversation_id: "conv1" }, makeCtx() as any)
    expect(result).toContain("in conv1")
    expect(result).not.toContain("in conv2")
  })

  it("respects limit", async () => {
    setup()
    for (let i = 0; i < 5; i++) insertMsg(db, { content: `msg_${i}` })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({ limit: 2 }, makeCtx() as any)
    expect(result).toContain("msg_")
    const count = (result.match(/\[\d+\]/g) ?? []).length
    expect(count).toBe(2)
  })

  it("marks messages as read after fetching", async () => {
    setup()
    insertMsg(db, { content: "unread msg" })
    const tool = createSessionReadTool({ db })
    await tool.execute({}, makeCtx() as any)
    const result2 = await tool.execute({ unread_only: false }, makeCtx() as any)
    const result3 = await tool.execute({}, makeCtx() as any)
    expect(result3).toContain("No unread messages")
  })

  it("excludes orphaned messages", async () => {
    setup()
    insertMsg(db, { content: "normal msg" })
    insertMsg(db, { content: "orphaned msg", status: "orphaned" })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({}, makeCtx() as any)
    expect(result).toContain("normal msg")
    expect(result).not.toContain("orphaned msg")
  })

  it("excludes expired messages", async () => {
    setup()
    insertMsg(db, { content: "fresh msg", ttl: Date.now() + 86400000 })
    insertMsg(db, { content: "expired msg", ttl: Date.now() - 1000 })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({ unread_only: false }, makeCtx() as any)
    expect(result).toContain("fresh msg")
    expect(result).not.toContain("expired msg")
  })

  it("returns formatted output with sender info", async () => {
    setup()
    insertMsg(db, { from_session: "other_sess", content: "test msg" })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({}, makeCtx() as any)
    expect(result).toContain("other_sess")
    expect(result).toContain("test msg")
  })

  it("returns 'No unread messages' when empty", async () => {
    setup()
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({}, makeCtx() as any)
    expect(result).toContain("No unread messages")
  })

  it("includes agent name and depth for each message", async () => {
    setup()
    upsertRegistry(db, "other_sess", { last_agent: "explore", last_active: Date.now(), current_depth: 2 })
    insertMsg(db, { from_session: "other_sess", content: "deep msg", depth: 2 })
    const tool = createSessionReadTool({ db })
    const result = await tool.execute({}, makeCtx() as any)
    expect(result).toContain("explore")
    expect(result).toContain("depth 2")
  })
})
