import { describe, it, expect, mock } from "bun:test"
import { createEventHook } from "../../src/hooks/event"
import { initDb, getRegistry, getMessages, upsertRegistry } from "../../src/db"
import type { Database } from "bun:sqlite"
import type { PluginConfig } from "../../src/config"

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

describe("event hook", () => {
  let db: Database

  function setup() {
    db = initDb(":memory:")
  }

  it("handles session.created — inserts registry", async () => {
    setup()
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({
      event: {
        type: "session.created",
        properties: { sessionID: "sess_new", info: { id: "sess_new", parentID: undefined } as any },
      },
    })
    const reg = getRegistry(db, "sess_new")
    expect(reg).toBeDefined()
  })

  it("handles session.created — sets is_subsession from parentID", async () => {
    setup()
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({
      event: {
        type: "session.created",
        properties: { sessionID: "sub_sess", info: { id: "sub_sess", parentID: "parent" } as any },
      },
    })
    const reg = getRegistry(db, "sub_sess")
    expect(reg).toBeDefined()
    expect(reg!.is_subsession).toBe(1)
  })

  it("handles session.idle — updates status, resets depth", async () => {
    setup()
    upsertRegistry(db, "sess_a", { status: "busy", current_depth: 3, last_active: Date.now() })
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({ event: { type: "session.idle", properties: { sessionID: "sess_a" } } })
    const reg = getRegistry(db, "sess_a")
    expect(reg!.status).toBe("available")
    expect(reg!.current_depth).toBe(0)
  })

  it("handles session.error — updates status to error", async () => {
    setup()
    upsertRegistry(db, "sess_a", { status: "available", last_active: Date.now() })
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({
      event: { type: "session.error", properties: { sessionID: "sess_a", error: { message: "timeout" } as any } },
    })
    const reg = getRegistry(db, "sess_a")
    expect(reg!.status).toBe("error")
  })

  it("handles session.deleted — marks messages orphaned", async () => {
    setup()
    upsertRegistry(db, "sess_del", { last_active: Date.now() })
    db.prepare(
      "INSERT INTO messages (conversation_id, from_session, to_session, content, timestamp, depth, ttl) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("c1", "other", "sess_del", "msg", Date.now(), 0, Date.now() + 86400000)
    db.prepare(
      "INSERT INTO messages (conversation_id, from_session, to_session, content, timestamp, depth, ttl) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("c2", "sess_del", "other", "msg2", Date.now(), 0, Date.now() + 86400000)
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({
      event: { type: "session.deleted", properties: { sessionID: "sess_del", info: { id: "sess_del" } as any } },
    })
    const msgs = getMessages(db, { status_exclude: ["orphaned"] })
    expect(msgs.length).toBe(0)
  })

  it("handles session.deleted — removes from registry", async () => {
    setup()
    upsertRegistry(db, "sess_del", { last_active: Date.now() })
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({
      event: { type: "session.deleted", properties: { sessionID: "sess_del", info: { id: "sess_del" } as any } },
    })
    const reg = getRegistry(db, "sess_del")
    expect(reg).toBeNull()
  })

  it("handles message.updated — updates last_agent for user messages", async () => {
    setup()
    upsertRegistry(db, "sess_a", { last_agent: "build", last_active: Date.now() })
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess_a",
          info: { role: "user", agent: "explore" } as any,
        },
      },
    })
    const reg = getRegistry(db, "sess_a")
    expect(reg!.last_agent).toBe("explore")
  })

  it("ignores unknown event types gracefully", async () => {
    setup()
    const hook = createEventHook({ db, config: defaultConfig })
    await hook({ event: { type: "unknown.event", properties: {} } })
  })
})
