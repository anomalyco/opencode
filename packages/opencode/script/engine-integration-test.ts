// Fengru Engine Integration Tests - Covering B (Database) and C (LLM) gaps

import { EngineDatabase } from "../src/agent/engine/db/engine-database"
import { DAGGenerator } from "../src/agent/engine/llm/dag-generator"
import { CapabilityRegistry, type Capability } from "../src/agent/engine/planner"
import { RepairMemoryEngine } from "../src/agent/engine/repair"
import { MemorySystem } from "../src/agent/engine/memory"
import { AgentEngine } from "../src/agent/engine/agent-engine"

let passed = 0
let failed = 0
const pending: Promise<void>[] = []

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn()
    if (result instanceof Promise) {
      pending.push(
        result.then(
          () => { passed++; console.log(`  PASS: ${name}`) },
          (err) => { failed++; console.log(`  FAIL: ${name}\n    ${err}`) },
        ),
      )
    } else {
      passed++
      console.log(`  PASS: ${name}`)
    }
  } catch (err: unknown) {
    failed++
    console.log(`  FAIL: ${name}\n    ${err instanceof Error ? err.message : String(err)}`)
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

console.log("B: Database Integration\n")

test("EngineDatabase initializes and creates tables", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()
  assert(db.isConnected(), "should be connected")
  db.close()
})

test("EngineDatabase insertEvents + queryEvents", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()

  const events = [
    { event_id: "e1", session_id: "s1", parent_event_id: null, event_type: "user_input", payload: '{"goal":"test"}', status: "success", token_cost: 0, duration_ms: 0, sequence_index: 1, timestamp: Date.now() },
    { event_id: "e2", session_id: "s1", parent_event_id: "e1", event_type: "agent_output", payload: '{"response":"done"}', status: "success", token_cost: 100, duration_ms: 500, sequence_index: 2, timestamp: Date.now() },
  ]

  await db.insertEvents(events)

  const result = db.queryEvents("s1")
  assert(result.length === 2, `should return 2 events, got ${result.length}`)
  assert(result[0]!.sequence_index === 1, "first event seq should be 1")
  assert(result[1]!.parent_event_id === "e1", "second event should have parent")

  const count = db.countEvents("s1")
  assert(count === 2, `should count 2 events, got ${count}`)

  db.close()
})

test("EngineDatabase insert + get checkpoints", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()

  const cp = {
    checkpoint_id: "cp_1",
    session_id: "s1",
    last_event_id: "e1",
    level: "L1" as const,
    execution_state: { state: "EXECUTING", progress: 0.5 },
    context_hash: "abc123",
    git_head_hash: "def456",
    created_at: Date.now(),
  }

  db.insertCheckpoint(cp)

  const retrieved = db.getLatestCheckpoint("s1")
  assert(retrieved !== null, "should retrieve checkpoint")
  assert(retrieved!.checkpoint_id === "cp_1", "checkpoint ID should match")
  assert(retrieved!.level === "L1", "level should be L1")
  assert(retrieved!.context_hash === "abc123", "context hash should match")
  assert(retrieved!.git_head_hash === "def456", "git head hash should match")

  const cp2 = {
    ...cp,
    checkpoint_id: "cp_2",
    level: "L2" as const,
    created_at: Date.now() + 1000,
  }
  db.insertCheckpoint(cp2)

  const latest = db.getLatestCheckpoint("s1")
  assert(latest!.checkpoint_id === "cp_2", "should return latest checkpoint")

  const l1Only = db.getLatestCheckpoint("s1", "L1")
  assert(l1Only!.checkpoint_id === "cp_1", "should return L1 when filtered")

  const all = db.getCheckpoints("s1")
  assert(all.length === 2, "should return all checkpoints")

  db.close()
})

test("EngineDatabase capabilities CRUD", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()

  const cap: Capability = {
    capability_id: "read_file",
    name: "Read File",
    description: "Read file contents",
    input_schema: { path: "string" },
    output_schema: { content: "string" },
    tags: ["file_operation", "read_only"],
    risk_level: 0,
    total_calls: 10,
    success_rate: 0.9,
    avg_duration_ms: 100,
    avg_token_cost: 50,
  }

  db.upsertCapability(cap)
  const caps = db.getCapabilities()
  assert(caps.length >= 1, "should return at least 1 capability")
  assert(caps[0]!.name === "Read File", "capability name should match")
  assert(caps[0]!.risk_level === 0, "risk level should be 0")
  assert(caps[0]!.success_rate === 0.9, "success rate should be 0.9")

  db.close()
})

test("EngineDatabase repair rules", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()

  db.upsertRepairRule({
    repair_id: "r1",
    tool: "bash",
    category: "not_found",
    condition: "tool='bash' AND context.contains('not_found')",
    recovery_action: "Run: touch <PATH>",
    specificity: 19,
    hit_count: 10,
    last_hit: Date.now(),
    occurrence_count: 1,
    success_rate: 0.95,
    created_at: Date.now(),
  })

  const rules = db.getRepairRules()
  assert(rules.length === 1, "should return 1 repair rule")
  assert(rules[0]!.specificity === 19, "specificity should be 19")
  assert(rules[0]!.success_rate === 0.95, "success rate should be 0.95")

  db.close()
})

test("EngineDatabase memory persistence", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()

  db.insertMemory({
    memory_id: "m1",
    content: "User prefers functional programming style",
    token_count: 8,
    importance: 0.8,
    access_count: 5,
    created_at: Date.now(),
    last_accessed: Date.now(),
    retention_score: 0.9,
  })

  const mems = db.getMemories("s1")
  assert(mems.length === 1, "should return 1 memory")
  assert(mems[0]!.content.includes("functional"), "content should match")

  db.close()
})

test("EngineDatabase skills", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()

  db.upsertSkill({
    skill_id: "sk1",
    trigger_condition: "typescript",
    prompt_template: "Use TypeScript strict mode",
    priority: 10,
    scope: "session",
    hit_count: 100,
    created_at: Date.now(),
  })

  const skills = db.getSkills()
  assert(skills.length === 1, "should return 1 skill")
  assert(skills[0]!.priority === 10, "priority should be 10")

  db.close()
})

console.log("\nC: LLM Integration\n")

test("DAGGenerator fallback produces valid DAG", () => {
  const gen = new DAGGenerator()
  const caps: Capability[] = [
    { capability_id: "read", name: "Read", description: "", input_schema: {}, output_schema: {}, tags: ["read_only"], risk_level: 0, total_calls: 100, success_rate: 1.0, avg_duration_ms: 50, avg_token_cost: 30 },
    { capability_id: "edit", name: "Edit", description: "", input_schema: {}, output_schema: {}, tags: ["write"], risk_level: 1, total_calls: 80, success_rate: 0.95, avg_duration_ms: 100, avg_token_cost: 50 },
    { capability_id: "test", name: "Test", description: "", input_schema: {}, output_schema: {}, tags: ["run"], risk_level: 1, total_calls: 50, success_rate: 0.9, avg_duration_ms: 200, avg_token_cost: 80 },
  ]

  const dag = gen.generateFallbackDAG("refactor authentication", caps)
  assert(dag.nodes.length <= 5, "fallback should limit to 5 nodes")
  assert(dag.edges.length === dag.nodes.length - 1, "fallback should be linear chain")
})

test("DAGGenerator buildPrompt includes capabilities", () => {
  const gen = new DAGGenerator()
  const caps: Capability[] = [
    { capability_id: "read", name: "Read File", description: "", input_schema: {}, output_schema: {}, tags: ["file"], risk_level: 0, total_calls: 0, success_rate: 1, avg_duration_ms: 0, avg_token_cost: 0 },
  ]

  const prompt = gen.buildPrompt("analyze codebase", caps)
  assert(prompt.includes("Read File"), "prompt should include capability name")
  assert(prompt.includes("analyze codebase"), "prompt should include goal")
  assert(prompt.includes("risk=0"), "prompt should include risk level")
})

test("DAGGenerator LLM caller integration", async () => {
  const gen = new DAGGenerator()
  gen.setLLMCaller(async (prompt: string) => {
    // Simulate LLM response
    return JSON.stringify({
      nodes: [
        { node_id: "n1", capability_id: "read", inputs: { path: "src/auth.ts" }, dependencies: [], risk_level: 0, estimated_tokens: 50, estimated_duration_ms: 1000 },
        { node_id: "n2", capability_id: "edit", inputs: { path: "src/auth.ts" }, dependencies: ["n1"], risk_level: 1, estimated_tokens: 100, estimated_duration_ms: 2000 },
      ],
      edges: [["n1", "n2"]],
    })
  })

  const caps: Capability[] = [
    { capability_id: "read", name: "Read", description: "", input_schema: {}, output_schema: {}, tags: ["file"], risk_level: 0, total_calls: 0, success_rate: 1, avg_duration_ms: 0, avg_token_cost: 0 },
    { capability_id: "edit", name: "Edit", description: "", input_schema: {}, output_schema: {}, tags: ["write"], risk_level: 1, total_calls: 0, success_rate: 1, avg_duration_ms: 0, avg_token_cost: 0 },
  ]

  const dag = await gen.generateDAG("refactor auth", caps)
  assert(dag.nodes.length === 2, `LLM should produce 2 nodes, got ${dag.nodes.length}`)
  assert(dag.nodes[0]!.capability_id === "read", "first node should be read")
  assert(dag.nodes[1]!.dependencies.includes("n1"), "second node should depend on n1")
  assert(dag.edges.length === 1, "should have 1 edge")
})

test("DAGGenerator replanDAG with error context", async () => {
  const gen = new DAGGenerator()
  gen.setLLMCaller(async () => {
    return JSON.stringify({
      nodes: [
        { node_id: "n1", capability_id: "read", inputs: {}, dependencies: [], risk_level: 0, estimated_tokens: 50, estimated_duration_ms: 1000 },
        { node_id: "n3", capability_id: "fix", inputs: {}, dependencies: ["n1"], risk_level: 1, estimated_tokens: 100, estimated_duration_ms: 2000 },
      ],
      edges: [["n1", "n3"]],
    })
  })

  const caps: Capability[] = [
    { capability_id: "read", name: "Read", description: "", input_schema: {}, output_schema: {}, tags: [], risk_level: 0, total_calls: 0, success_rate: 1, avg_duration_ms: 0, avg_token_cost: 0 },
    { capability_id: "fix", name: "Fix", description: "", input_schema: {}, output_schema: {}, tags: [], risk_level: 1, total_calls: 0, success_rate: 0.8, avg_duration_ms: 0, avg_token_cost: 0 },
  ]

  const dag = await gen.generateReplanDAG("refactor", caps, "Syntax error in n2", ["n1"], "n2")
  assert(dag.nodes.some((n) => n.capability_id === "fix"), "replanned DAG should include fix node")
  assert(dag.version === 2, "replanned DAG version should be 2")
})

console.log("\nB+C: Full Engine Integration\n")

test("AgentEngine with LLM DAG generation", async () => {
  const gen = new DAGGenerator()
  gen.setLLMCaller(async () => JSON.stringify({
    nodes: [
      { node_id: "n1", capability_id: "read", inputs: {}, dependencies: [], risk_level: 0, estimated_tokens: 50, estimated_duration_ms: 1000 },
    ],
    edges: [],
  }))

  const engine = new AgentEngine({ maxSteps: 10, tokenBudget: 10000 })
  await engine.initialize("session-db-test", "simple task", "workspace-hash-1")

  const caps: Capability[] = [
    { capability_id: "read", name: "Read", description: "", input_schema: {}, output_schema: {}, tags: ["read_only"], risk_level: 0, total_calls: 0, success_rate: 1, avg_duration_ms: 0, avg_token_cost: 0 },
  ]

  for (const cap of caps) {
    engine.registry.register(cap)
  }

  const { dag, strategy } = await engine.plan("simple task", caps)
  assert(dag.nodes.length > 0, "DAG should have nodes")
  assert(strategy === "SINGLE_SHOT" || strategy === "STAGED", "strategy should be valid")

  const snap = engine.getSnapshot()
  assert(snap.sessionId === "session-db-test", "snapshot should have session ID")
  assert(snap.state === "THINKING" || snap.state === "READY", "state should be valid")
})

test("AgentEngine resume with consistency check", async () => {
  const engine = new AgentEngine()
  await engine.initialize("session-cs", "test consistency", "hash-v1")

  // Set up DAG + create checkpoint for resume to find
  const caps: Capability[] = [{ capability_id: "read", name: "Read", description: "", input_schema: {}, output_schema: {}, tags: [], risk_level: 0, total_calls: 0, success_rate: 1, avg_duration_ms: 0, avg_token_cost: 0 }]
  engine.registry.register(caps[0]!)
  await engine.plan("test", caps)
  const cpId = await engine.createCheckpoint()
  assert(cpId !== "", "should create a checkpoint")

  // Simulate workspace change - resume with different hash
  const result = await engine.resume(undefined, "hash-v2")
  assert(result !== null, "resume should return a result")
  assert(result!.state === "PAUSED", `should pause on hash mismatch, got ${result!.state}`)
})

test("AgentEngine fork creates branch", async () => {
  const engine = new AgentEngine()
  await engine.initialize("session-fork-test", "test fork")

  const branch = await engine.fork("experimental-fix")
  assert(branch.parent_session_id === "session-fork-test", "branch should reference parent")
  assert(branch.status === "active", "branch should be active")
  assert(branch.branch_name === "experimental-fix", "branch name should match")
})

test("AgentEngine replay dry-run", async () => {
  const engine = new AgentEngine()
  const events = [
    { event_id: "ev1", session_id: "s1", parent_event_id: null, event_type: "state_transition", payload: { from: "IDLE", to: "INITIALIZING" }, sequence_index: 1, timestamp: Date.now() },
    { event_id: "ev2", session_id: "s1", parent_event_id: null, event_type: "state_transition", payload: { from: "INITIALIZING", to: "READY" }, sequence_index: 2, timestamp: Date.now() },
    { event_id: "ev3", session_id: "s1", parent_event_id: null, event_type: "tool_call", payload: { tool: "read" }, sequence_index: 3, timestamp: Date.now() },
  ]

  const result = await engine.replay("dry-run", events)
  assert(result.mode === "dry-run", "mode should be dry-run")
  assert(result.totalEvents === 3, "should have 3 total events")
  assert(result.replayedEvents === 3, "dry-run should replay all events")
  assert(result.stateTrajectory.length >= 1, "should capture state transitions")
})

test("AgentEngine shutdown transitions to SHUTTING_DOWN", async () => {
  const engine = new AgentEngine()
  await engine.initialize("session-shutdown", "test")
  await engine.shutdown()
  assert(engine.stateMachine.state === "SHUTTING_DOWN", "should be SHUTTING_DOWN after shutdown")
})

test("WorkerPool sequential execution", async () => {
  const { StatelessWorkerPool } = await import("../src/agent/engine/worker")
  const pool = new StatelessWorkerPool(2)

  pool.registerHandler("echo", async (task) => ({
    taskId: task.taskId,
    nodeId: task.nodeId,
    success: true,
    output: task.inputs,
    durationMs: 10,
    tokenCost: 5,
  }))

  const results = await pool.executeTasksSequential([
    { taskId: "t1", nodeId: "n1", capabilityId: "echo", inputs: { msg: "hello" }, contextSnapshot: { state_machine: { current_state: "EXECUTING", previous_state: "PLANNING", transition_count: 1 }, dag_progress: { version: 1, total_nodes: 3, completed_nodes: 0, failed_nodes: 0, node_statuses: {} }, pending_queue: [], workspace_hash: "" } },
    { taskId: "t2", nodeId: "n2", capabilityId: "echo", inputs: { msg: "world" }, contextSnapshot: { state_machine: { current_state: "EXECUTING", previous_state: "PLANNING", transition_count: 1 }, dag_progress: { version: 1, total_nodes: 3, completed_nodes: 1, failed_nodes: 0, node_statuses: {} }, pending_queue: [], workspace_hash: "" } },
  ])

  assert(results.length === 2, "should execute 2 tasks")
  assert(results[0]!.success, "first task should succeed")
  assert(results[1]!.success, "second task should succeed")
})

console.log(`\n${"=".repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed (${pending.length} async pending)`)
console.log(`${"=".repeat(40)}`)

await Promise.all(pending)

console.log(`\n${"=".repeat(40)}`)
console.log(`Final: ${passed} passed, ${failed} failed`)
console.log(`${"=".repeat(40)}`)

if (failed > 0) process.exit(1)
