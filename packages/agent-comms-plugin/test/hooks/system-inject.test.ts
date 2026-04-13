import { describe, it, expect } from "bun:test"
import { createSystemTransformHook } from "../../src/hooks/system-inject"
import { initDb, upsertRegistry, insertMessage, getConversation, upsertConversation } from "../../src/db"
import type { Database } from "bun:sqlite"

describe("system.transform hook", () => {
  let db: Database

  function setup() {
    db = initDb(":memory:")
    upsertRegistry(db, "self_sess", { last_agent: "build", last_active: Date.now() })
  }

  it("injects unread messages notification", async () => {
    setup()
    upsertRegistry(db, "other_sess", { last_agent: "build", last_active: Date.now() })
    insertMessage(db, {
      conversation_id: "conv1",
      from_session: "other_sess",
      to_session: "self_sess",
      content: "hello there",
      timestamp: Date.now(),
      read: 0,
      reply_to: null,
      depth: 1,
      type: "message",
      status: "delivered",
      retry_count: 0,
      ttl: Date.now() + 86400000,
    })
    upsertConversation(db, "conv1", ["other_sess", "self_sess"])

    const hook = createSystemTransformHook({ db })
    const output = { system: ["existing system prompt"] }
    await hook({ sessionID: "self_sess" }, output)
    expect(output.system.length).toBe(2)
    expect(output.system[1]).toContain("unread")
    expect(output.system[1]).toContain("other_sess")
  })

  it("includes sender session info with agent names", async () => {
    setup()
    upsertRegistry(db, "sender_sess", { last_agent: "explore", last_active: Date.now() })
    insertMessage(db, {
      conversation_id: "conv2",
      from_session: "sender_sess",
      to_session: "self_sess",
      content: "check this",
      timestamp: Date.now(),
      read: 0,
      reply_to: null,
      depth: 0,
      type: "message",
      status: "delivered",
      retry_count: 0,
      ttl: Date.now() + 86400000,
    })

    const hook = createSystemTransformHook({ db })
    const output = { system: [] }
    await hook({ sessionID: "self_sess" }, output)
    expect(output.system[0]).toContain("sender_sess")
    expect(output.system[0]).toContain("explore")
  })

  it("includes active conversations list", async () => {
    setup()
    upsertRegistry(db, "other", { last_agent: "build", last_active: Date.now() })
    insertMessage(db, {
      conversation_id: "conv3",
      from_session: "other",
      to_session: "self_sess",
      content: "msg",
      timestamp: Date.now(),
      read: 0,
      reply_to: null,
      depth: 0,
      type: "message",
      status: "delivered",
      retry_count: 0,
      ttl: Date.now() + 86400000,
    })
    upsertConversation(db, "conv3", ["other", "self_sess", "third"])

    const hook = createSystemTransformHook({ db })
    const output = { system: [] }
    await hook({ sessionID: "self_sess" }, output)
    expect(output.system[0]).toContain("conv3")
  })

  it("does NOT inject when no unread messages", async () => {
    setup()
    const hook = createSystemTransformHook({ db })
    const output = { system: ["existing"] }
    await hook({ sessionID: "self_sess" }, output)
    expect(output.system.length).toBe(1)
  })

  it("does NOT inject for sub-sessions (no sessionID)", async () => {
    setup()
    const hook = createSystemTransformHook({ db })
    const output = { system: [] }
    await hook({}, output)
    expect(output.system.length).toBe(0)
  })

  it("injects crash alert for crashed sessions", async () => {
    setup()
    upsertRegistry(db, "crashed_sess", { status: "crashed", last_agent: "build", last_active: Date.now() })
    upsertRegistry(db, "crashed_sess", { status: "crashed", last_agent: "build", last_active: Date.now() })

    const conv = getConversation(db, "crash_conv")
    if (!conv) upsertConversation(db, "crash_conv", ["self_sess", "crashed_sess"])

    insertMessage(db, {
      conversation_id: "crash_conv",
      from_session: "self_sess",
      to_session: "crashed_sess",
      content: "do work",
      timestamp: Date.now(),
      read: 0,
      reply_to: null,
      depth: 1,
      type: "message",
      status: "crashed",
      retry_count: 2,
      ttl: Date.now() + 86400000,
    })

    const hook = createSystemTransformHook({ db })
    const output = { system: [] }
    await hook({ sessionID: "self_sess" }, output)
    expect(output.system.length).toBeGreaterThan(0)
  })
})
