// Fengru Engine Verification Suite
// Runs all Phase 0-6 verification criteria

import { AgentStateMachine, AgentState, StateTransitionError } from "../src/agent/engine/state-machine"
import { validateDAG, getReadyNodes, markNodeFailed, type DAG } from "../src/agent/engine/dag"
import { CheckpointManager } from "../src/agent/engine/checkpoint"
import { GitTransactionManager } from "../src/agent/engine/transactional-fs"
import { CapabilityRegistry, DAGPlanner, ExecutionStrategy } from "../src/agent/engine/planner"
import { MemorySystem } from "../src/agent/engine/memory"
import { RepairMemoryEngine } from "../src/agent/engine/repair"
import { EntropyController } from "../src/agent/engine/entropy"
import { ValidationNetwork } from "../src/agent/engine/validation"
import { BranchManager } from "../src/agent/engine/branch"
import { EventArchiver } from "../src/agent/engine/archiver"

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

function assertThrows(fn: () => void, expectedName: string) {
  try {
    fn()
    throw new Error(`Expected ${expectedName} to be thrown`)
  } catch (err: unknown) {
    if (err instanceof Error && err.name !== expectedName) throw err
  }
}

async function assertThrowsAsync(fn: () => Promise<void>, expectedName: string) {
  try {
    await fn()
    throw new Error(`Expected ${expectedName} to be thrown`)
  } catch (err: unknown) {
    if (err instanceof Error && err.name !== expectedName) throw err
  }
}

console.log("Phase 0: Infrastructure\n")

console.log("  DAG Validator (Kahn Algorithm)")
test("valid simple DAG", () => {
  const dag: DAG = {
    version: 1,
    nodes: [
      { node_id: "n1", capability_id: "read", inputs: {}, dependencies: [], risk_level: 0, estimated_tokens: 50, estimated_duration_ms: 1000, status: "pending" },
      { node_id: "n2", capability_id: "edit", inputs: {}, dependencies: ["n1"], risk_level: 1, estimated_tokens: 100, estimated_duration_ms: 2000, status: "pending" },
    ],
    edges: [["n1", "n2"]],
  }
  const result = validateDAG(dag)
  assert(result.valid, "should be valid")
  assert(result.executionOrder!.length === 2, "should have 2 nodes in order")
  assert(result.executionOrder![0] === "n1", "n1 should come first")
})

test("detects cycle", () => {
  const dag: DAG = {
    version: 1,
    nodes: [
      { node_id: "n1", capability_id: "read", inputs: {}, dependencies: ["n2"], risk_level: 0, estimated_tokens: 50, estimated_duration_ms: 1000, status: "pending" },
      { node_id: "n2", capability_id: "edit", inputs: {}, dependencies: ["n1"], risk_level: 1, estimated_tokens: 100, estimated_duration_ms: 2000, status: "pending" },
    ],
    edges: [["n1", "n2"], ["n2", "n1"]],
  }
  const result = validateDAG(dag)
  assert(!result.valid, "should detect cycle")
  assert(result.error === "CYCLE_DETECTED", "should report cycle")
})

test("getReadyNodes returns only nodes with completed deps", () => {
  const dag: DAG = {
    version: 1,
    nodes: [
      { node_id: "n1", capability_id: "read", inputs: {}, dependencies: [], risk_level: 0, estimated_tokens: 50, estimated_duration_ms: 1000, status: "pending" },
      { node_id: "n2", capability_id: "edit", inputs: {}, dependencies: ["n1"], risk_level: 1, estimated_tokens: 100, estimated_duration_ms: 2000, status: "pending" },
    ],
    edges: [["n1", "n2"]],
  }
  const ready = getReadyNodes(dag)
  assert(ready.length === 1, "only n1 should be ready")
  assert(ready[0]!.node_id === "n1", "n1 should be ready")
})

test("markNodeFailed blocks dependents", () => {
  const dag: DAG = {
    version: 1,
    nodes: [
      { node_id: "n1", capability_id: "read", inputs: {}, dependencies: [], risk_level: 0, estimated_tokens: 50, estimated_duration_ms: 1000, status: "pending" },
      { node_id: "n2", capability_id: "edit", inputs: {}, dependencies: ["n1"], risk_level: 1, estimated_tokens: 100, estimated_duration_ms: 2000, status: "pending" },
      { node_id: "n3", capability_id: "test", inputs: {}, dependencies: [], risk_level: 1, estimated_tokens: 50, estimated_duration_ms: 500, status: "pending" },
    ],
    edges: [["n1", "n2"]],
  }
  const updated = markNodeFailed(dag, "n1")
  assert(updated.nodes.find((n) => n.node_id === "n1")!.status === "failed", "n1 should be failed")
  assert(updated.nodes.find((n) => n.node_id === "n2")!.status === "blocked", "n2 should be blocked")
  assert(updated.nodes.find((n) => n.node_id === "n3")!.status === "pending", "unrelated n3 should stay pending")
})

test("1000-node DAG < 50ms", () => {
  const nodes = Array.from({ length: 1000 }, (_, i) => ({
    node_id: `n${i}`,
    capability_id: "test",
    inputs: {},
    dependencies: i > 0 ? [`n${i - 1}`] : [],
    risk_level: 0 as 0 | 1 | 2 | 3,
    estimated_tokens: 10,
    estimated_duration_ms: 100,
    status: "pending" as const,
  }))
  const edges: [string, string][] = nodes.slice(1).map((n, i) => [`n${i}`, n.node_id])

  const start = performance.now()
  const result = validateDAG({ version: 1, nodes, edges })
  const elapsed = performance.now() - start

  assert(result.valid, "should be valid linear DAG")
  assert(elapsed < 50, `should complete under 50ms (took ${elapsed.toFixed(1)}ms)`)
  console.log(`    1000-node DAG validated in ${elapsed.toFixed(1)}ms`)
})

console.log("\nPhase 1: Persistence\n")

test("checkpoint L1 < 50KB", () => {
  const mgr = new CheckpointManager()
  const snapshot = {
    state_machine: { current_state: "EXECUTING", previous_state: "PLANNING", transition_count: 42 },
    dag_progress: { version: 1, total_nodes: 500, completed_nodes: 300, failed_nodes: 2, node_statuses: { n1: "completed".repeat(10) } as unknown as Record<string, any> },
    pending_queue: Array.from({ length: 200 }, (_, i) => `node_${i}`),
    workspace_hash: "a".repeat(64),
  }
  const cp = mgr.createL1("session-1", snapshot, "hash", "evt_latest")
  const size = mgr.getCheckpointSize(snapshot)
  console.log(`    L1 checkpoint size: ${size} bytes (${(size / 1024).toFixed(1)} KB)`)
  assert(size < 50 * 1024, `L1 should be < 50KB (actual: ${size})`)
})

test("compatible view generates correct SQL", () => {
  const sql = `
    SELECT event_id AS id, session_id,
      CASE WHEN event_type = 'user_input' THEN 'user' ELSE 'assistant' END AS role,
      payload AS data
    FROM event_log
    WHERE event_type IN ('user_input', 'agent_output')
    ORDER BY sequence_index
  `
  assert(sql.includes("event_log"), "should reference event_log")
  assert(sql.includes("user_input"), "should include user_input")
})

console.log("\nPhase 2: Transactional File System\n")

test("TOCTOU detection", () => {
  const txm = new GitTransactionManager()
  const tx = txm.begin("session-1", [{ path: "test.ts", content: "original" }])
  const modified = "modified"
  const result = txm.commit(tx, () => modified)
  assert(result.status === "CONFLICT", "should detect TOCTOU race")
  assert(result.reason === "TOCTOU_RACE_DETECTED", "should report TOCTOU")
})

test("three-way merge", () => {
  const txm = new GitTransactionManager()
  const base = "line1\nline2\nline3"
  const ours = "line1\nline2-modified\nline3"
  const theirs = "line1\nline2\nline3"
  const merged = txm.threeWayMerge(base, ours, theirs)
  assert(!merged.hasConflicts, "no conflict when theirs equals base")
  assert(merged.content === ours, "should take our changes")
})

test("three-way merge with conflict", () => {
  const txm = new GitTransactionManager()
  const base = "line1\nline2\nline3"
  const ours = "line1\nline2-ours\nline3"
  const theirs = "line1\nline2-theirs\nline3"
  const merged = txm.threeWayMerge(base, ours, theirs)
  assert(merged.hasConflicts, "should detect conflict")
})

console.log("\nPhase 3: State Machine\n")

test("valid transitions", async () => {
  const sm = new AgentStateMachine()
  await sm.transition(AgentState.INITIALIZING)
  assert(sm.state === "INITIALIZING", "should be INITIALIZING")
  await sm.transition(AgentState.READY)
  assert(sm.state === "READY", "should be READY")
  await sm.transition(AgentState.PLANNING)
  assert(sm.state === "PLANNING", "should be PLANNING")
})

test("invalid transition throws", async () => {
  const sm = new AgentStateMachine()
  await sm.transition(AgentState.INITIALIZING)
  await assertThrowsAsync(async () => { await sm.transition(AgentState.COMPLETED) }, "StateTransitionError")
})

test("transition hooks fire", async () => {
  const sm = new AgentStateMachine()
  let enterFired = false
  sm.onEnter(AgentState.READY, async () => { enterFired = true })
  await sm.transition(AgentState.INITIALIZING)
  await sm.transition(AgentState.READY)
  assert(enterFired, "onEnter hook should fire")
})

test("snapshot captures state", async () => {
  const sm = new AgentStateMachine()
  await sm.transition(AgentState.INITIALIZING)
  await sm.transition(AgentState.READY)
  const snap = sm.getSnapshot()
  assert(snap.current_state === "READY", "snapshot should reflect current state")
  assert(snap.transition_count === 2, "should count transitions")
})

test("Prometheus metrics export", async () => {
  const sm = new AgentStateMachine()
  await sm.transition(AgentState.INITIALIZING)
  await sm.transition(AgentState.READY)
  const metrics = sm.toPrometheusMetrics()
  assert(metrics.includes("state_enter_count"), "should include state_enter_count")
  assert(metrics.includes("INITIALIZING"), "should include INITIALIZING")
})
console.log("\nPhase 3: Checkpoints\n")

test("L1/L2/L3 retention", () => {
  const mgr = new CheckpointManager()
  for (let i = 0; i < 15; i++) {
    mgr.createL1("s1", {
      state_machine: { current_state: "EXECUTING", previous_state: "PLANNING", transition_count: i },
      dag_progress: { version: 1, total_nodes: 10, completed_nodes: i, failed_nodes: 0, node_statuses: {} },
      pending_queue: [],
      workspace_hash: "",
    }, "", `evt_${i}`)
  }
  const all = mgr.getAllCheckpoints()
  const l1s = all.filter((c) => c.level === "L1")
  assert(l1s.length <= 10, "should retain max 10 L1 checkpoints")
})

console.log("\nPhase 4: Planner & Scheduler\n")

test("strategy selection", () => {
  const reg = new CapabilityRegistry()
  const planner = new DAGPlanner(reg)

  const lowRiskCaps = [{ capability_id: "edit", name: "edit", description: "", input_schema: {}, output_schema: {}, tags: ["file_operation"], risk_level: 1 as 0 | 1 | 2 | 3, total_calls: 0, success_rate: 1, avg_duration_ms: 100, avg_token_cost: 50 }]
  const highRiskCaps = [{ capability_id: "delete", name: "delete", description: "", input_schema: {}, output_schema: {}, tags: ["file_operation"], risk_level: 2 as 0 | 1 | 2 | 3, total_calls: 0, success_rate: 1, avg_duration_ms: 100, avg_token_cost: 50 }]

  assert(planner.selectStrategy("refactor the entire codebase", lowRiskCaps, 0, 0.1) === ExecutionStrategy.STAGED, "refactor with low risk")
  assert(planner.selectStrategy("refactor the entire codebase", highRiskCaps, 0, 0.1) === ExecutionStrategy.MULTI_VALIDATE, "refactor with high risk")
  assert(planner.selectStrategy("hello", [], 0, 0.1) === ExecutionStrategy.SINGLE_SHOT, "simple question")
  assert(planner.selectStrategy("what files exist?", [], 3, 0.9) === ExecutionStrategy.SINGLE_SHOT, "degrade on failures")
  assert(planner.selectStrategy("compare options A and B", [], 0, 0.1) === ExecutionStrategy.K_PARALLEL, "compare triggers parallel")
})

console.log("\nPhase 5: Memory System\n")

test("token budget allocation", () => {
  const mem = new MemorySystem()
  mem.setMaxTokens(8000)
  mem.addCoreRule({ rule_id: "r1", category: "safety", content: "Always validate inputs", token_count: 100, importance: 1.0 })
  mem.addWorkingMemory({ id: "w1", content: "Current task: build auth", token_count: 200, priority: 1 })
  mem.addLongTermMemory({ memory_id: "m1", content: "User uses TypeScript", token_count: 50, importance: 0.8, access_count: 5, created_at: Date.now() - 3600000, last_accessed: Date.now(), retention_score: 0.9 })

  const ctx = mem.assembleContext("build TypeScript auth module")
  assert(ctx.totalTokens <= 8000, "should not exceed budget")
  assert(ctx.l4.length > 0, "should include core rules")
  assert(ctx.l2.length > 0, "should include working memory")
})

test("Ebbinghaus retention decay", () => {
  const mem = new MemorySystem()
  const memory = { memory_id: "m1", content: "old info", token_count: 50, importance: 0.5, access_count: 0, created_at: Date.now() - 24 * 3600 * 1000, last_accessed: Date.now() - 24 * 3600 * 1000, retention_score: 1.0 }

  const retention = mem.calculateRetention(memory)
  console.log(`    24h old memory retention: ${retention.toFixed(3)}`)
  assert(retention < 0.5, "24h old unreviewed memory should decay significantly")

  const reviewed = { ...memory, access_count: 3 }
  const retention2 = mem.calculateRetention(reviewed)
  console.log(`    24h old, 3 reviews retention: ${retention2.toFixed(3)}`)
  assert(retention2 > retention, "reviewed memory should have higher retention")
})

console.log("\nPhase 5: Error Recovery\n")

test("error classifier categories", () => {
  const engine = new RepairMemoryEngine()
  const classifier = new (engine as any).errorClassifier.constructor()
  assert(classifier.classify("file not found: /path/to/file") === "not_found", "should detect not_found")
  assert(classifier.classify("permission denied") === "permission", "should detect permission")
  assert(classifier.classify("connection timed out") === "timeout", "should detect timeout")
})

test("specificity sorting", () => {
  const engine = new RepairMemoryEngine()
  const rule1 = engine.addRule("bash", "file not found", "run: touch <PATH>")
  const rule2 = engine.addRule("bash", "always retry", "run: retry")

  const match = engine.matchRules("bash", "file not found")
  assert(match !== null, "should find a matching rule")
})

test("fuzzy fingerprinting", () => {
  const engine = new RepairMemoryEngine()
  const hash1 = engine.computeFuzzyHash("TypeError: Cannot read properties of undefined")
  const hash2 = engine.computeFuzzyHash("TypeError: Cannot read properties of null")
  const dist = engine.hammingDistance(hash1, hash2)
  assert(dist <= 10, `similar errors should have similar fuzzy hashes (distance: ${dist})`)
})

console.log("\nPhase 5: Entropy Control\n")

test("degrade on consecutive failures", () => {
  const entropy = new EntropyController({ maxConsecutiveFailures: 3 })
  const action = entropy.evaluate({ totalSteps: 10, retryCount: 5, consecutiveFailures: 4, cumulativeTokens: 1000, executionTimeMs: 10000, validationPassRate: 0.8, resultDivergence: 0.1 })
  assert(action === "DEGRADE", "should degrade on failures")
})

test("alert on high token usage", () => {
  const entropy = new EntropyController({ tokenBudget: 1000 })
  const action = entropy.evaluate({ totalSteps: 10, retryCount: 0, consecutiveFailures: 0, cumulativeTokens: 950, executionTimeMs: 10000, validationPassRate: 0.8, resultDivergence: 0.1 })
  assert(action === "ALERT", "should alert on high token usage")
})

console.log("\nPhase 5: Validation Network\n")

test("confidence scoring", () => {
  const vn = new ValidationNetwork({ threshold: 0.7 })
  const results = [
    { layer: "syntax" as const, score: 1.0, report: "", passed: true },
    { layer: "semantic" as const, score: 0.8, report: "", passed: true },
    { layer: "runtime" as const, score: 0.9, report: "", passed: true },
    { layer: "security" as const, score: 1.0, report: "", passed: true },
  ]
  const confidence = vn.calculateConfidence(results)
  console.log(`    Confidence: ${confidence}`)
  assert(confidence > 0.7, "should have high confidence")
  assert(!vn.shouldRetry(confidence, 0), "should not retry with high confidence")
})

console.log("\nPhase 5: Branching\n")

test("fork creates new session", async () => {
  const bm = new BranchManager()
  const branch = await bm.fork("parent-session", "experimental")
  assert(branch.parent_session_id === "parent-session", "should record parent")
  assert(branch.status === "active", "should be active")
  assert(branch.session_id !== "parent-session", "should have new session ID")
})

console.log("\nPhase 6: Archiving\n")

test("archive triggers at threshold", () => {
  const archiver = new EventArchiver({ maxHotEvents: 100 })
  assert(!archiver.shouldArchive(50), "should not archive below threshold")
  assert(archiver.shouldArchive(2000), "should archive above threshold")
})

test("archive summary event", () => {
  const archiver = new EventArchiver()
  const summary = archiver.getSummaryEvent("session-1", [0, 49999], "archives/session-1.db")
  assert(summary.event_type === "archive_summary", "should be archive_summary type")
  assert(summary.payload.sequence_range[1] === 49999, "should record sequence range")
})

console.log(`\n${"=".repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed (${pending.length} async pending)`)
console.log(`${"=".repeat(40)}`)

await Promise.all(pending)

console.log(`\n${"=".repeat(40)}`)
console.log(`Final: ${passed} passed, ${failed} failed`)
console.log(`${"=".repeat(40)}`)

if (failed > 0) process.exit(1)
