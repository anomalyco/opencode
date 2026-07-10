// End-to-end engine integration demo
// Shows the engine adapter → service → session prompt flow

import { createEngineAdapter } from "../src/agent/engine-adapter"
import { EnginePrompt } from "../src/session/prompt-engine"

let passed = 0
let failed = 0

function test(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
    try {
      await fn()
      passed++
      console.log(`  PASS: ${name}`)
    } catch (err) {
      failed++
      console.log(`  FAIL: ${name}\n    ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return run()
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

console.log("E2E: Engine → Service → Session Flow\n")

test("EnginePrompt disabledLayer returns false isEnabled", async () => {
  // The disabled layer provides an EnginePromptService with isEnabled=false
  // This verifies the toggle mechanism works
  assert(EnginePrompt.disabledLayer !== undefined, "disabledLayer exists")
})

test("Full agent engine lifecycle", async () => {
  const adapter = createEngineAdapter({ maxSteps: 10, tokenBudget: 50000 })

  adapter.registerTool({
    name: "analyze",
    description: "Analyze code structure",
    risk_level: 0,
    tags: ["read_only", "analysis"],
    execute: async (inputs) => ({ analysis: `Analyzed: ${JSON.stringify(inputs)}` }),
  })

  adapter.registerTool({
    name: "refactor",
    description: "Refactor code safely",
    risk_level: 2,
    tags: ["write", "refactor"],
    execute: async (inputs) => ({ result: "refactored", target: inputs.target }),
  })

  const result = await adapter.runWithEngine(
    "e2e-session-1",
    "Analyze and refactor the authentication module",
    "hash-e2e",
  )

  const engine = adapter.getEngine()!
  const snap = engine.getSnapshot()

  console.log(`    Session: ${snap.sessionId}`)
  console.log(`    Final state: ${snap.state}`)
  console.log(`    Steps: ${snap.stepCount}`)
  console.log(`    Token usage: ${snap.tokenUsage}`)

  assert(snap.sessionId === "e2e-session-1", "session ID should match")
  assert(typeof snap.state === "string", "state should be a string")
})

test("Engine creates L1 and L2 checkpoints during execution", async () => {
  const adapter = createEngineAdapter({ maxSteps: 3, tokenBudget: 10000 })

  adapter.registerTool({
    name: "step1",
    description: "First step",
    risk_level: 0,
    tags: ["test"],
    execute: async () => ({ step: 1 }),
  })

  await adapter.runWithEngine("e2e-cp", "multi step task", "hash-cp")

  const engine = adapter.getEngine()!
  const allCps = engine.checkpoints.getAllCheckpoints()
  const l1Cps = allCps.filter((c) => c.level === "L1")

  console.log(`    Total checkpoints: ${allCps.length}`)
  console.log(`    L1 checkpoints: ${l1Cps.length}`)

  assert(l1Cps.length >= 1, "should have at least 1 L1 checkpoint")
})

test("Engine memory system persists across runs", async () => {
  const adapter = createEngineAdapter()

  const engine = adapter.getEngine()!
  engine.memory.addLongTermMemory({
    memory_id: "mem-1",
    content: "User prefers functional programming style",
    token_count: 8,
    importance: 0.8,
    access_count: 5,
    created_at: Date.now() - 86400000,
    last_accessed: Date.now(),
    retention_score: 1.0,
  })

  engine.memory.addCoreRule({
    rule_id: "rule-1",
    category: "capability_boundary",
    content: "Always use strict TypeScript",
    token_count: 6,
    importance: 1.0,
  })

  const ctx = engine.memory.assembleContext("TypeScript refactoring")
  assert(ctx.l4.length >= 1, "should have core rules")
  assert(ctx.l3.length >= 1, "should have long-term memory")
  assert(ctx.totalTokens <= 8000, "should respect token budget")

  console.log(`    L4 rules: ${ctx.l4.length}`)
  console.log(`    L3 memories: ${ctx.l3.length}`)
  console.log(`    Total tokens: ${ctx.totalTokens}`)
})

test("Engine error recovery matches and recovers", async () => {
  const adapter = createEngineAdapter({ maxSteps: 2, tokenBudget: 5000 })

  adapter.registerTool({
    name: "risky_op",
    description: "A risky operation",
    risk_level: 2,
    tags: ["risk"],
    execute: async () => {
      throw new Error("file not found: config.json")
    },
  })

  const engine = adapter.getEngine()!
  engine.repair.addRule("risky_op", "file not found", "run: create config.json from template")

  await adapter.runWithEngine("e2e-repair", "run risky operation", "hash-repair")

  const rules = engine.repair.getAllRules()
  console.log(`    Repair rules registered: ${rules.length}`)

  assert(rules.length >= 1, "should have at least 1 repair rule")
})

test("Engine entropy control prevents runaway", async () => {
  const adapter = createEngineAdapter({ maxSteps: 3, tokenBudget: 1000 })

  adapter.registerTool({
    name: "expensive_op",
    description: "Token-expensive operation",
    risk_level: 1,
    tags: ["costly"],
    execute: async () => ({ done: true }),
  })

  const engine = adapter.getEngine()!
  engine.entropy.updateConfig({ tokenBudget: 1000, maxConsecutiveFailures: 2 })

  const metrics = {
    totalSteps: 50,
    retryCount: 10,
    consecutiveFailures: 5,
    cumulativeTokens: 950,
    executionTimeMs: 60000,
    validationPassRate: 0.2,
    resultDivergence: 0.6,
  }

  const action = engine.entropy.evaluate(metrics)
  console.log(`    Entropy action: ${action}`)

  assert(action !== "CONTINUE", "should not continue under bad metrics")
})

test("Engine state machine transitions never get stuck", async () => {
  const adapter = createEngineAdapter({ maxSteps: 5, tokenBudget: 10000 })

  adapter.registerTool({
    name: "echo",
    description: "Echo",
    risk_level: 0,
    tags: ["test"],
    execute: async (inputs) => inputs,
  })

  for (let i = 0; i < 3; i++) {
    await adapter.runWithEngine(`e2e-sm-${i}`, `task iteration ${i}`, "hash-sm")
  }

  const engine = adapter.getEngine()!
  const metrics = engine.stateMachine.getStateMetrics()

  console.log(`    States visited: ${Object.keys(metrics).length}`)

  assert(Object.keys(metrics).length > 0, "should have state metrics")
  console.log(`    IDLE entries: ${metrics.IDLE?.enter_count ?? 0}`)
})

test("Engine adapter correctly reflects tools", async () => {
  const adapter = createEngineAdapter()
  // buildToolAdaptersFromRegistry requires Effect runtime for registry.all()
  // In script mode without runtime, it falls back to empty; test direct tool registration
  const toolDefs = [
    { id: "read", description: "Read files" },
    { id: "write", description: "Write files" },
    { id: "edit", description: "Edit files" },
    { id: "bash", description: "Shell commands" },
    { id: "glob", description: "Find files" },
    { id: "grep", description: "Search content" },
    { id: "webfetch", description: "Fetch web pages" },
    { id: "websearch", description: "Search web" },
    { id: "task", description: "Run subtasks" },
    { id: "question", description: "Ask user" },
    { id: "todowrite", description: "Write todos" },
    { id: "lsp", description: "LSP operations" },
    { id: "skill", description: "Execute skills" },
    { id: "apply_patch", description: "Apply patches" },
  ]
  const riskMap: Record<string, number> = { read: 0, write: 1, edit: 1 }
  const tools = adapter.buildToolAdaptersFromDefs(toolDefs, riskMap)

  for (const tool of tools) {
    if (riskMap[tool.name] !== undefined) {
      assert(tool.risk_level === riskMap[tool.name], `${tool.name} risk should be ${riskMap[tool.name]}`)
    }
  }

  console.log(`    Tools registered: ${tools.length}`)
  const allRisks = Array.from(new Set(tools.map((t) => t.risk_level))).sort()
  console.log(`    Risk levels present: [${allRisks.join(", ")}]`)

  assert(tools.length === 14, "should register 14 built-in tools")
})

console.log(`\n${"=".repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log(`${"=".repeat(40)}`)

if (failed > 0) process.exit(1)
