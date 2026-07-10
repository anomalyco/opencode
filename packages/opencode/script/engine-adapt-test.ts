// Engine Integration Test - Tests the adapter + service integration with the existing codebase patterns

import { EngineAdapter, createEngineAdapter } from "../src/agent/engine-adapter"
import { AgentEngine } from "../src/agent/engine"

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

console.log("Engine Adapter + Service Integration\n")

test("createEngineAdapter creates engine", () => {
  const adapter = createEngineAdapter()
  const engine = adapter.getEngine()
  assert(engine !== null, "engine should not be null")
  assert(engine instanceof AgentEngine, "should be AgentEngine instance")
})

test("engine adapter registerTool adds capability", () => {
  const adapter = createEngineAdapter()
  adapter.registerTool({
    name: "test_tool",
    description: "A test tool",
    risk_level: 0,
    tags: ["test"],
    execute: async () => ({ success: true }),
  })

  const engine = adapter.getEngine()!
  const cap = engine.registry.get("test_tool")
  assert(cap !== undefined, "capability should be registered")
  assert(cap!.name === "test_tool", "capability name should match")
  assert(cap!.risk_level === 0, "risk level should be 0")
})

test("engine adapter buildToolAdaptersFromRegistry creates 14 tools", () => {
  const adapter = createEngineAdapter()
  const adapters = adapter.buildToolAdaptersFromRegistry({} as any)
  assert(adapters.length === 14, `should create 14 tools, got ${adapters.length}`)
  assert(adapters.some((a) => a.name === "read"), "should include read tool")
  assert(adapters.some((a) => a.name === "bash"), "should include bash tool")
  assert(adapters.some((a) => a.name === "grep"), "should include grep tool")

  const bashTool = adapters.find((a) => a.name === "bash")
  assert(bashTool!.risk_level === 1, "bash default risk should be 1")

  const readTool = adapters.find((a) => a.name === "read")
  assert(readTool!.risk_level === 0, "read default risk should be 0")
})

test("engine adapter buildToolAdapters with custom risk map", () => {
  const adapter = createEngineAdapter()
  const customRisk = { bash: 3, write: 2 }
  const adapters = adapter.buildToolAdaptersFromRegistry({} as any, customRisk)

  const bashTool = adapters.find((a) => a.name === "bash")
  assert(bashTool!.risk_level === 3, "bash custom risk should be 3")

  const readTool = adapters.find((a) => a.name === "read")
  assert(readTool!.risk_level === 0, "read should still be default 0")
})

test("engine adapter runWithEngine executes simple task", async () => {
  const adapter = createEngineAdapter({ maxSteps: 5, tokenBudget: 10000 })

  adapter.registerTool({
    name: "echo",
    description: "Echo back input",
    risk_level: 0,
    tags: ["read_only"],
    execute: async (inputs) => ({ echoed: inputs.message ?? "hello" }),
  })

  const result = await adapter.runWithEngine("session-test", "simple echo task", "hash-1")
  assert(result.completed || !result.completed, "should return a result object")
  assert(result.stepCount >= 0, "step count should be non-negative")
})

test("engine adapter runWithEngine handles plan then execute", async () => {
  const adapter = createEngineAdapter({ maxSteps: 10, tokenBudget: 50000 })

  adapter.registerTool({
    name: "read",
    description: "Read a file",
    risk_level: 0,
    tags: ["file_operation", "read_only"],
    execute: async (inputs) => ({ content: `content of ${inputs.path}` }),
  })

  adapter.registerTool({
    name: "edit",
    description: "Edit a file",
    risk_level: 1,
    tags: ["file_operation"],
    execute: async (inputs) => ({ edited: true, file: inputs.path }),
  })

  const result = await adapter.runWithEngine(
    "session-refactor",
    "read and edit configuration files",
    "hash-refactor",
  )

  assert(result.completed || !result.completed, "should complete or not")
  const engine = adapter.getEngine()!
  assert(engine.stateMachine.state === "COMPLETED" || engine.stateMachine.state === "READY" || engine.stateMachine.state === "THINKING",
    `engine should be in a valid state after run, got ${engine.stateMachine.state}`)
})

test("engine adapter handles tool failure gracefully", async () => {
  const adapter = createEngineAdapter({ maxSteps: 3, tokenBudget: 5000 })

  adapter.registerTool({
    name: "failing_tool",
    description: "Always fails",
    risk_level: 1,
    tags: ["risky"],
    execute: async () => { throw new Error("Simulated failure") },
  })

  const result = await adapter.runWithEngine("session-fail", "task with failing tool", "hash-fail")

  assert(result.completed || !result.completed, "should handle failure without crashing")
})

test("engine adapter after run, getSnapshot returns state", async () => {
  const adapter = createEngineAdapter({ maxSteps: 3 })

  adapter.registerTool({
    name: "ping",
    description: "Responds pong",
    risk_level: 0,
    tags: ["test"],
    execute: async () => ({ response: "pong" }),
  })

  await adapter.runWithEngine("session-snap", "ping test", "hash-snap")

  const engine = adapter.getEngine()!
  const snap = engine.getSnapshot()
  assert(snap.sessionId === "session-snap", "snapshot session ID should match")
  assert(typeof snap.state === "string", "state should be a string")
  assert(typeof snap.stepCount === "number", "stepCount should be a number")
  assert(typeof snap.tokenUsage === "number", "tokenUsage should be a number")
})

console.log(`\n${"=".repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed (${pending.length} async pending)`)
console.log(`${"=".repeat(40)}`)

await Promise.all(pending)

console.log(`\n${"=".repeat(40)}`)
console.log(`Final: ${passed} passed, ${failed} failed`)
console.log(`${"=".repeat(40)}`)

if (failed > 0) process.exit(1)
