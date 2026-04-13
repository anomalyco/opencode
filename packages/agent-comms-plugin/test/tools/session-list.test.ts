import { describe, it, expect, mock } from "bun:test"
import { createSessionListTool } from "../../src/tools/session-list"
import { initDb, upsertRegistry, getUnreadCount } from "../../src/db"
import type { AgentConfig } from "../../src/config"
import type { Database } from "bun:sqlite"

type MockClient = {
  session: {
    list: ReturnType<typeof mock>
    status: ReturnType<typeof mock>
  }
}

function makeContext(overrides?: Record<string, unknown>) {
  return {
    sessionID: "self_session",
    messageID: "m1",
    agent: "build",
    directory: "/project",
    worktree: "/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ...overrides,
  }
}

const mockSessions = [
  { id: "sess_a", title: "Fix auth", parentID: undefined, time: { created: 1000, updated: 2000 } },
  { id: "sess_b", title: "Refactor utils", parentID: undefined, time: { created: 1000, updated: 2000 } },
  { id: "sess_sub", title: "Sub task", parentID: "sess_a", time: { created: 1000, updated: 2000 } },
]

describe("session_list tool", () => {
  let db: Database
  let mockClient: MockClient

  function setup(clientOverrides?: Partial<MockClient>) {
    db = initDb(":memory:")
    mockClient = {
      session: {
        list: mock(async () => ({
          data: mockSessions,
        })),
        status: mock(async () => ({
          data: {
            sess_a: { type: "idle" },
            sess_b: { type: "busy" },
            sess_sub: { type: "idle" },
          },
        })),
      },
      ...clientOverrides,
    }
    return mockClient
  }

  it("returns list of primary sessions (filters out sub-sessions)", async () => {
    const client = setup()
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("sess_a")
    expect(result).toContain("sess_b")
    expect(result).not.toContain("sess_sub")
  })

  it("filters out sub-sessions (parentID != null)", async () => {
    const client = setup()
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).not.toContain("sess_sub")
  })

  it("includes last agent name for each session", async () => {
    const client = setup()
    upsertRegistry(db, "sess_a", { last_agent: "build", last_active: Date.now() })
    upsertRegistry(db, "sess_b", { last_agent: "explore", last_active: Date.now() })
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("build")
    expect(result).toContain("explore")
  })

  it("includes permission summary for each session", async () => {
    const client = setup()
    upsertRegistry(db, "sess_a", { last_agent: "build", last_active: Date.now() })
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("full permissions")
  })

  it("includes depth from registry", async () => {
    const client = setup()
    upsertRegistry(db, "sess_a", { current_depth: 2, last_active: Date.now() })
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("depth: 2")
  })

  it("includes unread count from messages table", async () => {
    const client = setup()
    upsertRegistry(db, "sess_a", { last_agent: "build", last_active: Date.now() })
    db.prepare(
      "INSERT INTO messages (conversation_id, from_session, to_session, content, timestamp, depth, ttl) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("conv1", "other", "sess_a", "hello", Date.now(), 0, Date.now() + 86400000)
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("Unread: 1")
  })

  it("excludes current session from list", async () => {
    const client = setup()
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext({ sessionID: "sess_a" }) as any)
    expect(result).not.toContain("sess_a")
  })

  it("handles empty session list", async () => {
    const client = setup({
      session: {
        list: mock(async () => ({ data: [] })),
        status: mock(async () => ({ data: {} })),
      },
    })
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("No other sessions")
  })

  it("handles SDK error gracefully", async () => {
    const client = setup({
      session: {
        list: mock(async () => {
          throw new Error("SDK connection failed")
        }),
        status: mock(async () => ({ data: {} })),
      },
    })
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("Error")
    expect(result).toContain("SDK connection failed")
  })

  it("handles sessions without registry entry (shows defaults)", async () => {
    const client = setup()
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("sess_b")
    expect(result).toContain("unknown")
  })

  it("shows session status from SDK", async () => {
    const client = setup()
    upsertRegistry(db, "sess_a", { last_agent: "build", last_active: Date.now() })
    upsertRegistry(db, "sess_b", { last_agent: "explore", last_active: Date.now() })
    const tool = createSessionListTool({ client, db, configAgents: undefined })
    const result = await tool.execute({}, makeContext() as any)
    expect(result).toContain("idle")
    expect(result).toContain("busy")
  })
})
