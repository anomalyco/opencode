import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { EngineDatabase } from "../../../src/agent/engine/db/engine-database"

// Drizzle-equivalent engine table creation
// This mirrors what the Drizzle migration 20260617000000_add_engine_tables does
function createEngineTablesViaDrizzle(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS event_log (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_event_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending','running','success','failed','skipped')),
      token_cost INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      sequence_index INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    )
  `)
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_event_session_seq ON event_log(session_id, sequence_index)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_parent ON event_log(parent_event_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_type ON event_log(session_id, event_type, timestamp)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS checkpoint (
      checkpoint_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      last_event_id TEXT,
      level TEXT NOT NULL CHECK(level IN ('L1','L2','L3')),
      execution_state TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      git_head_hash TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_cp_session ON checkpoint(session_id, level, created_at)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS capability_graph (
      capability_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      input_schema TEXT,
      output_schema TEXT,
      tags TEXT,
      risk_level INTEGER DEFAULT 0,
      total_calls INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      avg_duration_ms INTEGER DEFAULT 0,
      avg_token_cost INTEGER DEFAULT 0,
      last_used_at INTEGER
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_cap_evolution ON capability_graph(total_calls, success_rate)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS session_memory (
      memory_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      importance REAL DEFAULT 0.5,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER,
      retention_score REAL DEFAULT 1.0,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_mem_retention ON session_memory(session_id, retention_score)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS repair_memory (
      repair_id TEXT PRIMARY KEY,
      error_category TEXT NOT NULL,
      exact_hash TEXT NOT NULL,
      fuzzy_hash TEXT NOT NULL,
      error_type TEXT NOT NULL,
      core_symbols TEXT,
      condition TEXT NOT NULL,
      recovery_action TEXT NOT NULL,
      success_rate REAL DEFAULT 0.0,
      hit_count INTEGER DEFAULT 0,
      specificity INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_repair_exact ON repair_memory(exact_hash)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_repair_fuzzy ON repair_memory(fuzzy_hash)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS skill (
      skill_id TEXT PRIMARY KEY,
      trigger_condition TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      scope TEXT DEFAULT 'session',
      hit_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)
}

type BunSQLiteRow = Record<string, unknown>

let db: Database

beforeEach(() => {
  db = new Database(":memory:")
  db.run("PRAGMA journal_mode=WAL")
  db.run("PRAGMA foreign_keys=ON")
  // Create minimal session table (required by engine FK references in migrations)
  db.run(`
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    )
  `)
  // Run engine migrations to create engine tables
  createEngineTablesViaDrizzle(db)

  // Insert test sessions for FK constraints
  db.run(`INSERT OR IGNORE INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
    VALUES ('s1', 'p1', 'test-session', '/tmp/test', 'Test Session', 'v2', 1000, 2000)`)
  db.run(`INSERT OR IGNORE INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
    VALUES ('session-a', 'p1', 'session-a', '/tmp/a', 'Session A', 'v2', 1000, 2000)`)
  db.run(`INSERT OR IGNORE INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
    VALUES ('session-b', 'p1', 'session-b', '/tmp/b', 'Session B', 'v2', 1000, 2000)`)
  // "global" pseudo-session for global-scoped memories
  db.run(`INSERT OR IGNORE INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
    VALUES ('global', 'p1', 'global', '/tmp/global', 'Global', 'v2', 1000, 2000)`)
})

afterEach(() => {
  db.close()
})

describe("EngineDatabase + Drizzle Coexistence", () => {
  test("EngineDatabase.fromDrizzleDatabase connects to existing tables", async () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)
    await engineDb.initialize()
    // Initialize should be a no-op when external=true
    expect(engineDb.isConnected()).toBe(true)
  })

  test("insertEvents persists and queries correctly", async () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)
    await engineDb.initialize()

    await engineDb.insertEvents([
      {
        event_id: "evt-1",
        session_id: "s1",
        parent_event_id: null,
        event_type: "user_input",
        payload: '{"message":"hello"}',
        status: "success",
        token_cost: 100,
        duration_ms: 50,
        sequence_index: 1,
        timestamp: Date.now(),
      },
      {
        event_id: "evt-2",
        session_id: "s1",
        parent_event_id: "evt-1",
        event_type: "tool_call",
        payload: '{"tool":"read"}',
        status: "success",
        token_cost: 200,
        duration_ms: 100,
        sequence_index: 2,
        timestamp: Date.now(),
      },
    ])

    const events = engineDb.queryEvents("s1")
    expect(events.length).toBe(2)
    expect(events[0].event_id).toBe("evt-1")
    expect(events[1].event_type).toBe("tool_call")
    expect(engineDb.countEvents("s1")).toBe(2)
  })

  test("insertCheckpoint and query checkpoints", () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)

    engineDb.insertCheckpoint({
      checkpoint_id: "cp_l1_1",
      session_id: "s1",
      last_event_id: "evt-1",
      level: "L1",
      execution_state: { state: "executing", progress: 0.5 },
      context_hash: "abc123",
      created_at: Date.now(),
    })

    const latest = engineDb.getLatestCheckpoint("s1")
    expect(latest).not.toBeNull()
    expect(latest!.checkpoint_id).toBe("cp_l1_1")
    expect(latest!.level).toBe("L1")
    expect(latest!.execution_state.state).toBe("executing")

    const all = engineDb.getCheckpoints("s1")
    expect(all.length).toBe(1)
  })

  test("upsertCapability and query capabilities", () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)

    engineDb.upsertCapability({
      capability_id: "read",
      name: "read",
      description: "Read files",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      tags: ["file_operation", "read_only"],
      risk_level: 0,
      total_calls: 10,
      success_rate: 0.9,
      avg_duration_ms: 50,
      avg_token_cost: 100,
    })

    const caps = engineDb.getCapabilities()
    expect(caps.length).toBe(1)
    expect(caps[0].name).toBe("read")
    expect(caps[0].risk_level).toBe(0)
  })

  test("upsertRepairRule and query", () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)

    engineDb.upsertRepairRule({
      repair_id: "repair-1",
      tool: "read",
      category: "not_found",
      condition: "ENOENT",
      recovery_action: "Retry with different path",
      specificity: 5,
      hit_count: 3,
      last_hit: Date.now(),
      occurrence_count: 3,
      success_rate: 0.8,
      created_at: Date.now(),
    })

    const rules = engineDb.getRepairRules()
    expect(rules.length).toBe(1)
    expect(rules[0].category).toBe("not_found")
  })

  test("insertMemory and query memories", () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)

    engineDb.insertMemory({
      memory_id: "mem-1",
      content: "User prefers TypeScript over JavaScript",
      token_count: 10,
      importance: 0.9,
      access_count: 5,
      created_at: Date.now(),
      last_accessed: Date.now(),
      retention_score: 0.95,
    })

    const memories = engineDb.getMemories("s1")
    expect(memories.length).toBe(1)
    expect(memories[0].content).toBe("User prefers TypeScript over JavaScript")
  })

  test("upsertSkill and query skills", () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)

    engineDb.upsertSkill({
      skill_id: "skill-1",
      trigger_condition: "user mentions testing",
      prompt_template: "Write unit tests for {code}",
      priority: 5,
      scope: "session",
      hit_count: 2,
      created_at: Date.now(),
    })

    const skills = engineDb.getSkills()
    expect(skills.length).toBe(1)
    expect(skills[0].trigger_condition).toBe("user mentions testing")
  })

  test("standalone EngineDatabase creates its own tables", async () => {
    const standalone = new EngineDatabase(":memory:")
    await standalone.initialize()
    expect(standalone.isConnected()).toBe(true)

    // Tables should be creatable
    standalone.upsertCapability({
      capability_id: "test",
      name: "test",
      description: "Test",
      input_schema: {},
      output_schema: {},
      tags: [],
      risk_level: 0,
      total_calls: 0,
      success_rate: 1.0,
      avg_duration_ms: 0,
      avg_token_cost: 0,
    })

    const caps = standalone.getCapabilities()
    expect(caps.length).toBe(1)

    standalone.close()
  })

  test("persistBusEvent works with external database", async () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)
    await engineDb.initialize()

    engineDb.persistBusEvent({
      type: "state_transition",
      source: "test",
      session_id: "s1",
      data: { from: "IDLE", to: "READY" },
      priority: 1,
      timestamp: Date.now(),
      require_persistence: true,
    })

    const events = engineDb.queryEvents("s1")
    expect(events.length).toBe(1)
    expect(events[0].event_type).toBe("state_transition")
  })

  test("sequence_index auto-increments per session", async () => {
    const engineDb = EngineDatabase.fromDrizzleDatabase(db)
    await engineDb.initialize()

    // persistBusEvent auto-increments sequence per session
    engineDb.persistBusEvent({
      type: "task_start",
      source: "test",
      session_id: "session-a",
      data: { msg: "a1" },
      priority: 1,
      timestamp: Date.now(),
      require_persistence: true,
    })
    engineDb.persistBusEvent({
      type: "user_input",
      source: "test",
      session_id: "session-a",
      data: { msg: "a2" },
      priority: 1,
      timestamp: Date.now(),
      require_persistence: true,
    })
    engineDb.persistBusEvent({
      type: "agent_output",
      source: "test",
      session_id: "session-a",
      data: { msg: "a3" },
      priority: 1,
      timestamp: Date.now(),
      require_persistence: true,
    })

    // Session B gets one event via insertEvents
    await engineDb.insertEvents([
      {
        event_id: "b1",
        session_id: "session-b",
        parent_event_id: null,
        event_type: "task_start",
        payload: "{}",
        status: "success",
        token_cost: 0,
        duration_ms: 0,
        sequence_index: 1,
        timestamp: Date.now(),
      },
    ])

    // Session A should have 3 events
    expect(engineDb.countEvents("session-a")).toBe(3)
    // Session B should have 1
    expect(engineDb.countEvents("session-b")).toBe(1)
  })
})
