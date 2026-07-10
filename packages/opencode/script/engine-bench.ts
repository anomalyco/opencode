// Fengru Engine Performance Benchmarks
// Verifies all benchmarks from the architecture document (Section 12)

import { validateDAG, type DAG } from "../src/agent/engine/dag"
import { CheckpointManager, type L1Snapshot } from "../src/agent/engine/checkpoint"
import { EventArchiver } from "../src/agent/engine/archiver"
import { EngineDatabase } from "../src/agent/engine/db/engine-database"
import { RepairMemoryEngine } from "../src/agent/engine/repair"
import { AgentStateMachine, AgentState } from "../src/agent/engine/state-machine"

type BenchResult = { name: string; value: number; unit: string; target: string; passed: boolean }

const results: BenchResult[] = []
const pendingBench: Promise<void>[] = []

function bench(name: string, target: string, fn: () => number | Promise<number>, unit: string, isGood: (v: number) => boolean) {
  pendingBench.push(
    (async () => {
      const value = await fn()
      const passed = isGood(value)
      results.push({ name, value, unit, target, passed })
      console.log(`  ${passed ? "PASS" : "FAIL"}: ${name} = ${value.toFixed(1)}${unit} (target: ${target})`)
    })(),
  )
}

function makeSnapshot(nodes: number, completed: number): L1Snapshot {
  const statuses: Record<string, any> = {}
  for (let i = 0; i < nodes; i++) {
    statuses[`n${i}`] = i < completed ? "completed" : "pending"
  }
  return {
    state_machine: { current_state: "EXECUTING", previous_state: "PLANNING", transition_count: nodes },
    dag_progress: { version: 1, total_nodes: nodes, completed_nodes: completed, failed_nodes: 0, node_statuses: statuses },
    pending_queue: Array.from({ length: nodes - completed }, (_, i) => `n${completed + i}`),
    workspace_hash: "a".repeat(64),
  }
}

function makeDAG(n: number): DAG {
  return {
    version: 1,
    nodes: Array.from({ length: n }, (_, i) => ({
      node_id: `n${i}`, capability_id: "test", inputs: {}, dependencies: i > 0 ? [`n${i - 1}`] : [],
      risk_level: 0 as 0|1|2|3, estimated_tokens: 100, estimated_duration_ms: 1000, status: "pending" as const,
    })),
    edges: Array.from({ length: n - 1 }, (_, i) => [`n${i}`, `n${i + 1}`] as [string, string]),
  }
}

console.log("12.1 DAG Validation Performance\n")

bench("Kahn 1000-node DAG", "< 50 ms", () => {
  const nodes = Array.from({ length: 1000 }, (_, i) => ({
    node_id: `n${i}`, capability_id: "test", inputs: {},
    dependencies: i > 0 ? [`n${i - 1}`] : [],
    risk_level: 0 as 0|1|2|3, estimated_tokens: 10, estimated_duration_ms: 100, status: "pending" as const,
  }))
  const edges: [string, string][] = nodes.slice(1).map((n, i) => [`n${i}`, n.node_id])
  const dag: DAG = { version: 1, nodes, edges }
  const start = performance.now()
  validateDAG(dag)
  return performance.now() - start
}, "ms", (v) => v < 50)

bench("Kahn 100-node dense DAG", "< 10 ms", () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    node_id: `n${i}`, capability_id: "test", inputs: {},
    dependencies: Array.from({ length: Math.min(i, 5) }, (_, j) => `n${i - j - 1}`),
    risk_level: 0 as 0|1|2|3, estimated_tokens: 10, estimated_duration_ms: 100, status: "pending" as const,
  }))
  const edges: [string, string][] = []
  for (const n of nodes) {
    for (const dep of n.dependencies) {
      edges.push([dep, n.node_id])
    }
  }
  const dag: DAG = { version: 1, nodes, edges }
  const start = performance.now()
  validateDAG(dag)
  return performance.now() - start
}, "ms", (v) => v < 10)

bench("Cycle detection (100-node ring)", "< 10 ms", () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    node_id: `n${i}`, capability_id: "test", inputs: {},
    dependencies: i === 0 ? ["n99"] : [`n${i - 1}`],
    risk_level: 0 as 0|1|2|3, estimated_tokens: 10, estimated_duration_ms: 100, status: "pending" as const,
  }))
  const edges: [string, string][] = nodes.map((n, i) => i === 0 ? ["n99", n.node_id] : [`n${i - 1}`, n.node_id])
  const dag: DAG = { version: 1, nodes, edges }
  const start = performance.now()
  const r = validateDAG(dag)
  if (r.valid) throw new Error("Should detect cycle!")
  return performance.now() - start
}, "ms", (v) => v < 10)

console.log("\n12.2 Checkpoint Size Model\n")

const mgr = new CheckpointManager()

bench("L1 simple (5 nodes)", "< 5 KB", () => {
  const snap = makeSnapshot(5, 5)
  return mgr.getCheckpointSize(snap) / 1024
}, "KB", (v) => v < 5)

bench("L1 medium (100 nodes)", "< 50 KB", () => {
  const snap = makeSnapshot(100, 50)
  return mgr.getCheckpointSize(snap) / 1024
}, "KB", (v) => v < 50)

bench("L1 large (500 nodes)", "< 50 KB", () => {
  const snap = makeSnapshot(500, 200)
  return mgr.getCheckpointSize(snap) / 1024
}, "KB", (v) => v < 50)

bench("L2 medium (100 nodes)", "< 500 KB", () => {
  const l1 = makeSnapshot(100, 50)
  const dag = makeDAG(100)
  const context = {
    system_prompt_ref: "x".repeat(2000),
    key_conclusions: Array.from({ length: 5 }, (_, i) => ({ text: `conclusion ${i}`, confidence: 0.9 })),
    recent_messages: Array.from({ length: 50 }, (_, i) => ({
      event_id: `evt_${i}`, sequence_index: i, summary: `msg ${i}: `.repeat(10), token_count: 50,
    })),
    file_contexts: Array.from({ length: 10 }, (_, i) => ({
      file_path: `/path/to/file${i}.ts`, content_hash: "a".repeat(64),
      relevant_lines: [i * 10, i * 10 + 10] as [number, number], summary: `file summary ${i}`,
    })),
    memory_pointers: [],
  }
  const l2 = { l1_data: l1, context_summary: context, dag_full: dag, memory_pointers: [] }
  return mgr.getCheckpointSize(l2) / 1024
}, "KB", (v) => v < 500)

bench("L3 archive snapshot", "< 10 KB", () => {
  const l3 = {
    l2_data: { l1_data: makeSnapshot(10, 10), context_summary: {} as any, dag_full: makeDAG(10), memory_pointers: [] },
    archive_reference: { archive_path: "archives/s1.db", event_count: 50000, sequence_range: [0, 49999] as [number, number] },
    session_metadata: { title: "test", goal: "benchmark", total_events: 50000, total_tokens: 1000000, duration_ms: 300000, created_at: Date.now(), completed_at: Date.now() },
  }
  return mgr.getCheckpointSize(l3) / 1024
}, "KB", (v) => v < 10)

console.log("\n12.3 SQLite Write Performance\n")

bench("Batch insert 5000 events", "> 5000 events/s", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()
  const events = Array.from({ length: 5000 }, (_, i) => ({
    event_id: `evt_${i}`, session_id: "bench", parent_event_id: i > 0 ? `evt_${i - 1}` : null,
    event_type: "tool_call" as any, payload: JSON.stringify({ index: i }),
    status: "success", token_cost: 10, duration_ms: 50, sequence_index: i, timestamp: Date.now(),
  }))
  const start = performance.now()
  await db.insertEvents(events)
  const elapsed = performance.now() - start
  const rate = (5000 / elapsed) * 1000
  db.close()
  return rate
}, "events/s", (v) => v > 5000)

bench("Query 5000 events", "> 1000 events/s", async () => {
  const db = new EngineDatabase(":memory:")
  await db.initialize()
  const events = Array.from({ length: 5000 }, (_, i) => ({
    event_id: `evt_${i}`, session_id: "bench", parent_event_id: null,
    event_type: "tool_call" as any, payload: "{}", status: "success", token_cost: 0, duration_ms: 0, sequence_index: i, timestamp: Date.now(),
  }))
  await db.insertEvents(events)
  const start = performance.now()
  const result = db.queryEvents("bench", 0, 5000)
  const elapsed = performance.now() - start
  const rate = (result.length / elapsed) * 1000
  db.close()
  return rate
}, "events/s", (v) => v > 1000)

console.log("\n12.4 Error Recovery Performance\n")

bench("Error classifier throughput", "> 1000 classifications/s", () => {
  const engine = new RepairMemoryEngine()
  const errors = Array.from({ length: 1000 }, (_, i) =>
    `Error: file not found ${i} at /path/to/file${i}.ts line ${i}`)
  const start = performance.now()
  for (const e of errors) {
    const classifier = new (engine as any).errorClassifier.constructor()
    classifier.classify(e)
  }
  const elapsed = performance.now() - start
  return (1000 / elapsed) * 1000
}, "cls/s", (v) => v > 1000)

bench("Fuzzy hash computation", "> 10000 hashes/s", () => {
  const engine = new RepairMemoryEngine()
  const errors = Array.from({ length: 1000 }, (_, i) =>
    `TypeError: Cannot read property 'foo${i}' of undefined at Module.method${i}`)
  const start = performance.now()
  for (const e of errors) {
    engine.computeFuzzyHash(e)
  }
  const elapsed = performance.now() - start
  return (1000 / elapsed) * 1000
}, "hashes/s", (v) => v > 10000)

console.log("\n12.5 State Machine Performance\n")

bench("1000 state transitions", "> 5000 transitions/s", async () => {
  const sm = new AgentStateMachine()
  const start = performance.now()
  for (let i = 0; i < 500; i++) {
    sm.reset()
    await sm.transition(AgentState.INITIALIZING)
    await sm.transition(AgentState.READY)
  }
  const elapsed = performance.now() - start
  return (1000 / elapsed) * 1000
}, "tx/s", (v) => v > 5000)

console.log("\n12.6 Memory System Performance\n")

bench("Token budget allocation 1000 memories", "< 15 ms", () => {
  const { MemorySystem } = require("../src/agent/engine/memory")
  const ms = new MemorySystem()
  for (let i = 0; i < 1000; i++) {
    ms.addLongTermMemory({
      memory_id: `m${i}`, content: `memory content ${i}: `.repeat(5),
      token_count: 10 + (i % 50), importance: Math.random(), access_count: i % 10,
      created_at: Date.now() - i * 3600000, last_accessed: Date.now() - i * 1000, retention_score: Math.random(),
    })
  }
  const start = performance.now()
  ms.assembleContext("benchmark goal")
  return performance.now() - start
}, "ms", (v) => v < 15)

console.log("\n12.7 Archive Size Estimation\n")

bench("archive estimate 100K events", "< 20 MB", () => {
  const archiver = new EventArchiver()
  return archiver.estimateArchiveSize(100_000) / (1024 * 1024)
}, "MB", (v) => v < 20)

bench("archive threshold detection", "10K hot + 50K trigger", () => {
  const archiver = new EventArchiver({ maxHotEvents: 10000 })
  return archiver.shouldArchive(51000) ? 1 : 0
}, "bool", (v) => v === 1)

await Promise.all(pendingBench)

console.log(`\n${"=".repeat(50)}`)
const total = results.length
const p = results.filter((r) => r.passed).length
console.log(`Results: ${p}/${total} passed`)
results.forEach((r) => {
  if (!r.passed) console.log(`  FAIL: ${r.name} = ${r.value.toFixed(1)}${r.unit} (target: ${r.target})`)
})
console.log(`${"=".repeat(50)}`)
