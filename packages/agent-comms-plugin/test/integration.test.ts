import { describe, it, expect, mock } from "bun:test"
import { initDb, upsertRegistry, getMessages, getRegistry, getConversation } from "../src/db"
import { createSessionSendTool } from "../src/tools/session-send"
import { createSessionReadTool } from "../src/tools/session-read"
import { createEventHook } from "../src/hooks/event"
import { createSystemTransformHook } from "../src/hooks/system-inject"
import type { Database } from "bun:sqlite"
import type { PluginConfig } from "../src/config"

const config: PluginConfig = {
  max_depth: 5,
  max_retry: 2,
  sync_timeout_ms: 60000,
  broadcast_max_recipients: 10,
  broadcast_rate_limit_per_minute: 5,
  include_thinking: false,
  message_ttl_ms: 86400000,
  db_path: ":memory:",
}

function makeCtx(overrides?: Record<string, unknown>) {
  return {
    sessionID: "agent_a",
    messageID: "m1",
    agent: "build",
    directory: "/project",
    worktree: "/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ...overrides,
  }
}

describe("integration: spawn and communicate", () => {
  let db: Database

  function setup() {
    db = initDb(":memory:")
    upsertRegistry(db, "agent_a", { current_depth: 0, last_agent: "build", last_active: Date.now() })
  }

  it("agent A spawns session B and gets response", async () => {
    setup()
    const client = {
      session: {
        create: mock(async () => ({ data: { id: "sess_b", title: "Worker" } })),
        get: mock(async () => ({ data: {} })),
        prompt: mock(async () => ({
          info: { id: "resp1" },
          parts: [{ type: "text", text: "Found 3 auth files" }],
        })),
        promptAsync: mock(async () => ({ data: undefined })),
        status: mock(async () => ({ data: {} })),
        list: mock(async () => ({ data: [] })),
      },
    }

    const send = createSessionSendTool({ client, db, config })
    const result = await send.execute(
      { message: "Find all auth files", new_session: true, agent: "explore" },
      makeCtx() as any,
    )

    expect(result).toContain("sess_b")
    expect(result).toContain("Found 3 auth files")

    const msgs = getMessages(db, { from_session: "agent_a" })
    expect(msgs.length).toBe(1)
    expect(msgs[0].to_session).toBe("sess_b")

    const reg = getRegistry(db, "sess_b")
    expect(reg!.current_depth).toBe(1)
  })

  it("agent A sends follow-up to session B", async () => {
    setup()
    upsertRegistry(db, "sess_b", { last_agent: "explore", current_depth: 1, last_active: Date.now() })

    const client = {
      session: {
        create: mock(async () => ({ data: {} })),
        get: mock(async () => ({
          data: { id: "sess_b", title: "Worker", parentID: undefined },
        })),
        prompt: mock(async () => ({
          info: { id: "resp2" },
          parts: [{ type: "text", text: "auth.test.ts exists" }],
        })),
        promptAsync: mock(async () => ({ data: undefined })),
        status: mock(async () => ({
          data: { sess_b: { type: "idle" } },
        })),
        list: mock(async () => ({ data: [] })),
      },
    }

    const send = createSessionSendTool({ client, db, config })
    const result = await send.execute(
      { message: "Does auth.test.ts exist?", session_id: "sess_b", conversation_id: "conv1" },
      makeCtx() as any,
    )

    expect(result).toContain("auth.test.ts exists")
    expect(result).toContain("conv1")
  })

  it("agent A reads response from session B", async () => {
    setup()
    upsertRegistry(db, "sess_b", { last_agent: "explore", current_depth: 1, last_active: Date.now() })

    db.prepare(
      "INSERT INTO messages (conversation_id, from_session, to_session, content, timestamp, read, depth, type, status, retry_count, ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "conv1",
      "sess_b",
      "agent_a",
      "Here are the results",
      Date.now(),
      0,
      1,
      "response",
      "delivered",
      0,
      Date.now() + 86400000,
    )

    const read = createSessionReadTool({ db })
    const result = await read.execute({}, makeCtx() as any)

    expect(result).toContain("Here are the results")
    expect(result).toContain("sess_b")
    expect(result).toContain("explore")
  })

  it("conversation_id persists across multiple exchanges", async () => {
    setup()
    upsertRegistry(db, "sess_b", { last_agent: "build", current_depth: 1, last_active: Date.now() })

    const client = {
      session: {
        create: mock(async () => ({ data: {} })),
        get: mock(async () => ({
          data: { id: "sess_b", title: "Worker", parentID: undefined },
        })),
        prompt: mock(async () => ({
          info: { id: "r" },
          parts: [{ type: "text", text: "ok" }],
        })),
        promptAsync: mock(async () => ({ data: undefined })),
        status: mock(async () => ({
          data: { sess_b: { type: "idle" } },
        })),
        list: mock(async () => ({ data: [] })),
      },
    }

    const send = createSessionSendTool({ client, db, config })
    await send.execute({ message: "first", session_id: "sess_b", conversation_id: "conv_persist" }, makeCtx() as any)
    await send.execute({ message: "second", session_id: "sess_b", conversation_id: "conv_persist" }, makeCtx() as any)

    const msgs = getMessages(db, { conversation_id: "conv_persist" })
    expect(msgs.length).toBe(4)
    expect(msgs.filter((m) => m.type === "message").length).toBe(2)
    expect(msgs.filter((m) => m.type === "response").length).toBe(2)
    expect(msgs.every((m) => m.conversation_id === "conv_persist")).toBe(true)
  })
})

describe("integration: error recovery", () => {
  let db: Database

  function setup() {
    db = initDb(":memory:")
    upsertRegistry(db, "agent_a", { current_depth: 0, last_agent: "build", last_active: Date.now() })
  }

  it("depth limit prevents infinite delegation", async () => {
    setup()
    upsertRegistry(db, "agent_a", { current_depth: 5, last_agent: "build", last_active: Date.now() })

    const client = {
      session: {
        create: mock(async () => ({ data: {} })),
        get: mock(async () => ({ data: {} })),
        prompt: mock(async () => ({})),
        promptAsync: mock(async () => ({ data: undefined })),
        status: mock(async () => ({ data: {} })),
        list: mock(async () => ({ data: [] })),
      },
    }

    const send = createSessionSendTool({ client, db, config })
    const result = await send.execute({ message: "go deeper", new_session: true, agent: "explore" }, makeCtx() as any)
    expect(result).toContain("Maximum nesting depth")
  })
})

describe("integration: sub-session isolation", () => {
  let db: Database

  function setup() {
    db = initDb(":memory:")
    upsertRegistry(db, "agent_a", { current_depth: 0, last_agent: "build", last_active: Date.now() })
    upsertRegistry(db, "sub_sess", { is_subsession: 1, last_agent: "general", last_active: Date.now() })
  }

  it("session_send rejects sub-session target", async () => {
    setup()
    const client = {
      session: {
        create: mock(async () => ({ data: {} })),
        get: mock(async () => ({
          data: { id: "sub_sess", title: "Sub", parentID: "agent_a" },
        })),
        prompt: mock(async () => ({ data: {} })),
        promptAsync: mock(async () => ({ data: undefined })),
        status: mock(async () => ({ data: {} })),
        list: mock(async () => ({ data: [] })),
      },
    }

    const send = createSessionSendTool({ client, db, config })
    const result = await send.execute({ message: "hello", session_id: "sub_sess" }, makeCtx() as any)
    expect(result).toContain("sub-session")
  })
})

describe("integration: lifecycle", () => {
  let db: Database

  function setup() {
    db = initDb(":memory:")
    upsertRegistry(db, "agent_a", { current_depth: 0, last_agent: "build", last_active: Date.now() })
  }

  it("session.idle resets depth", async () => {
    setup()
    upsertRegistry(db, "sess_b", { current_depth: 3, last_agent: "explore", last_active: Date.now() })

    const hook = createEventHook({ db, config })
    await hook({ event: { type: "session.idle", properties: { sessionID: "sess_b" } } })

    const reg = getRegistry(db, "sess_b")
    expect(reg!.current_depth).toBe(0)
    expect(reg!.status).toBe("available")
  })

  it("session.deleted marks messages orphaned", async () => {
    setup()
    upsertRegistry(db, "sess_del", { last_active: Date.now() })

    db.prepare(
      "INSERT INTO messages (conversation_id, from_session, to_session, content, timestamp, depth, type, status, retry_count, ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("c1", "agent_a", "sess_del", "msg", Date.now(), 0, "message", "delivered", 0, Date.now() + 86400000)

    const hook = createEventHook({ db, config })
    await hook({ event: { type: "session.deleted", properties: { sessionID: "sess_del", info: { id: "sess_del" } } } })

    const msgs = getMessages(db, { status_exclude: ["orphaned"] })
    expect(msgs.length).toBe(0)
  })

  it("system prompt inject shows unread messages", async () => {
    setup()
    upsertRegistry(db, "sess_b", { last_agent: "explore", last_active: Date.now() })

    db.prepare(
      "INSERT INTO messages (conversation_id, from_session, to_session, content, timestamp, read, depth, type, status, retry_count, ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("c1", "sess_b", "agent_a", "result", Date.now(), 0, 1, "message", "delivered", 0, Date.now() + 86400000)

    const hook = createSystemTransformHook({ db })
    const output = { system: [] }
    await hook({ sessionID: "agent_a" }, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("unread")
    expect(output.system[0]).toContain("sess_b")
  })

  it("system prompt inject disappears after reading", async () => {
    setup()
    upsertRegistry(db, "sess_b", { last_agent: "explore", last_active: Date.now() })

    db.prepare(
      "INSERT INTO messages (conversation_id, from_session, to_session, content, timestamp, read, depth, type, status, retry_count, ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("c1", "sess_b", "agent_a", "result", Date.now(), 0, 1, "message", "delivered", 0, Date.now() + 86400000)

    const read = createSessionReadTool({ db })
    await read.execute({}, makeCtx() as any)

    const hook = createSystemTransformHook({ db })
    const output = { system: [] }
    await hook({ sessionID: "agent_a" }, output)

    expect(output.system.length).toBe(0)
  })
})
