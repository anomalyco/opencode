import { describe, it, expect, mock } from "bun:test"
import { createSessionSendTool } from "../../src/tools/session-send"
import { initDb, upsertRegistry, getMessages, getRegistry, getConversation } from "../../src/db"
import type { Database } from "bun:sqlite"
import type { PluginConfig } from "../../src/config"

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

const defaultConfig: PluginConfig = {
  max_depth: 5,
  max_retry: 2,
  sync_timeout_ms: 60000,
  broadcast_max_recipients: 10,
  broadcast_rate_limit_per_minute: 5,
  include_thinking: false,
  message_ttl_ms: 86400000,
  db_path: ":memory:",
}

function baseMocks() {
  return {
    create: mock(async () => ({ data: { id: "new_sess", title: "New session" } })),
    get: mock(async () => ({
      data: { id: "target_sess", title: "Target", parentID: undefined },
    })),
    prompt: mock(async () => ({
      info: { id: "msg1" },
      parts: [{ type: "text", text: "response text" }],
    })),
    promptAsync: mock(async () => ({ data: undefined })),
    status: mock(async () => ({
      data: { target_sess: { type: "idle" } },
    })),
  }
}

describe("session_send pre-flight", () => {
  let db: Database

  function setup(sessionOverrides?: Record<string, any>) {
    db = initDb(":memory:")
    upsertRegistry(db, "self_sess", { current_depth: 0, last_active: Date.now() })
    const session = { ...baseMocks(), ...sessionOverrides }
    const client = { session }
    return client
  }

  it("rejects self-send", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hi", session_id: "self_sess" }, makeCtx() as any)
    expect(result).toContain("Cannot send message to yourself")
  })

  it("rejects sub-session target", async () => {
    const client = setup({
      get: mock(async () => ({
        data: { id: "sub_sess", title: "Sub", parentID: "parent_sess" },
      })),
    })
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hi", session_id: "sub_sess" }, makeCtx() as any)
    expect(result).toContain("Cannot send messages to sub-sessions")
  })

  it("rejects when max depth reached", async () => {
    const client = setup()
    upsertRegistry(db, "self_sess", { current_depth: 5, last_active: Date.now() })
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hi", session_id: "target_sess" }, makeCtx() as any)
    expect(result).toContain("Maximum nesting depth")
  })

  it("rejects when target not found", async () => {
    const client = setup({
      get: mock(async () => {
        throw new Error("Not found")
      }),
    })
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hi", session_id: "missing_sess" }, makeCtx() as any)
    expect(result).toContain("not found")
  })

  it("rejects busy target in sync mode", async () => {
    const client = setup({
      status: mock(async () => ({
        data: { target_sess: { type: "busy" } },
      })),
    })
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hi", session_id: "target_sess", wait: true }, makeCtx() as any)
    expect(result).toContain("busy")
  })

  it("allows busy target in async mode", async () => {
    const client = setup({
      status: mock(async () => ({
        data: { target_sess: { type: "busy" } },
      })),
    })
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hi", session_id: "target_sess", wait: false }, makeCtx() as any)
    expect(result).toContain("Message sent")
  })

  it("ignores session_id when new_session=true", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute(
      { message: "hi", new_session: true, session_id: "ignored_id", agent: "explore" },
      makeCtx() as any,
    )
    expect(result).toContain("new_sess")
    expect(result).not.toContain("ignored_id")
  })
})

describe("session_send new_session=true", () => {
  let db: Database

  function setup(sessionOverrides?: Record<string, any>) {
    db = initDb(":memory:")
    upsertRegistry(db, "self_sess", { current_depth: 0, last_active: Date.now() })
    const session = {
      ...baseMocks(),
      create: mock(async () => ({ data: { id: "new_sess_1", title: "New" } })),
      ...sessionOverrides,
    }
    const client = { session }
    return client
  }

  it("creates new session via client.session.create()", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    expect(client.session.create).toHaveBeenCalled()
  })

  it("sends message via client.session.prompt() after create", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    expect(client.session.prompt).toHaveBeenCalled()
  })

  it("uses specified agent type", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    const call = client.session.prompt.mock.calls[0]
    expect(call[0].agent).toBe("explore")
  })

  it("falls back to build agent when agent not specified", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true }, makeCtx() as any)
    const call = client.session.prompt.mock.calls[0]
    expect(call[0].agent).toBe("build")
  })

  it("falls back to build agent when agent not found", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true, agent: "nonexistent" }, makeCtx() as any)
    const call = client.session.prompt.mock.calls[0]
    expect(call[0].agent).toBe("build")
  })

  it("auto-generates conversation_id", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    expect(result).toContain("Conversation:")
    const msgs = getMessages(db, { from_session: "self_sess" })
    expect(msgs.length).toBe(1)
    expect(msgs[0].conversation_id).toBeTruthy()
  })

  it("uses provided conversation_id", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute(
      { message: "hello", new_session: true, agent: "explore", conversation_id: "my_conv" },
      makeCtx() as any,
    )
    expect(result).toContain("my_conv")
    const msgs = getMessages(db, { from_session: "self_sess" })
    expect(msgs[0].conversation_id).toBe("my_conv")
  })

  it("returns session_id and conversation_id in response", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    expect(result).toContain("new_sess_1")
    expect(result).toContain("Conversation:")
  })

  it("records message in SQLite after SDK success", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    const msgs = getMessages(db, { from_session: "self_sess" })
    expect(msgs.length).toBe(1)
    expect(msgs[0].to_session).toBe("new_sess_1")
    expect(msgs[0].content).toBe("hello")
  })

  it("updates registry after SDK success", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    const reg = getRegistry(db, "new_sess_1")
    expect(reg).toBeDefined()
    expect(reg!.current_depth).toBe(1)
  })

  it("creates conversation record", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute(
      { message: "hello", new_session: true, agent: "explore", conversation_id: "conv_test" },
      makeCtx() as any,
    )
    const conv = getConversation(db, "conv_test")
    expect(conv).toBeDefined()
  })

  it("does NOT record in SQLite if SDK call fails", async () => {
    const client = setup({
      create: mock(async () => {
        throw new Error("Create failed")
      }),
    })
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", new_session: true, agent: "explore" }, makeCtx() as any)
    const msgs = getMessages(db, {})
    expect(msgs.length).toBe(0)
  })
})

describe("session_send new_session=false", () => {
  let db: Database

  function setup(sessionOverrides?: Record<string, any>) {
    db = initDb(":memory:")
    upsertRegistry(db, "self_sess", { current_depth: 0, last_active: Date.now() })
    upsertRegistry(db, "target_sess", { last_agent: "build", last_active: Date.now(), current_depth: 0 })
    const session = { ...baseMocks(), ...sessionOverrides }
    const client = { session }
    return client
  }

  it("sends message to existing session", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hello", session_id: "target_sess" }, makeCtx() as any)
    expect(result).toContain("response text")
  })

  it("requires session_id when new_session=false", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hello" }, makeCtx() as any)
    expect(result).toContain("session_id is required")
  })

  it("records in SQLite after SDK success", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    await tool.execute({ message: "hello", session_id: "target_sess", conversation_id: "conv1" }, makeCtx() as any)
    const msgs = getMessages(db, { from_session: "self_sess" })
    expect(msgs.length).toBe(1)
    expect(msgs[0].to_session).toBe("target_sess")
  })

  it("handles async mode", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hello", session_id: "target_sess", wait: false }, makeCtx() as any)
    expect(result).toContain("Message sent")
    expect(result).toContain("async")
    expect(client.session.promptAsync).toHaveBeenCalled()
  })
})

describe("session_send retry", () => {
  let db: Database

  function setup(sessionOverrides?: Record<string, any>) {
    db = initDb(":memory:")
    upsertRegistry(db, "self_sess", { current_depth: 0, last_active: Date.now() })
    upsertRegistry(db, "target_sess", { last_agent: "build", last_active: Date.now(), current_depth: 0 })
    const session = {
      ...baseMocks(),
      prompt: mock(async () => {
        throw new Error("Session crashed: internal error")
      }),
      ...sessionOverrides,
    }
    const client = { session }
    return client
  }

  it("returns crash notification when prompt throws", async () => {
    const client = setup()
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hello", session_id: "target_sess" }, makeCtx() as any)
    expect(result).toContain("crashed")
    expect(result).toContain("internal error")
    expect(result).toContain("Retry:")
  })

  it("does not retry in async mode on failure", async () => {
    const client = setup({
      promptAsync: mock(async () => {
        throw new Error("crash")
      }),
    })
    const tool = createSessionSendTool({ client, db, config: defaultConfig })
    const result = await tool.execute({ message: "hello", session_id: "target_sess", wait: false }, makeCtx() as any)
    expect(result).toContain("Error")
    expect(result).toContain("crash")
  })
})
