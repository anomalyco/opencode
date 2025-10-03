import { describe, expect, test, beforeEach } from "bun:test"
import { Metric } from "../../src/evaluation/metric"
import { EvaluationEngine } from "../../src/evaluation/engine"
import { Dataset } from "../../src/evaluation/dataset"
import { TestRunner } from "../../src/evaluation/runner"
import type { Trace } from "../../src/trace"

// Clean up test data
const testIds: string[] = []

beforeEach(async () => {
  for (const id of testIds) {
    try {
      await Metric.remove(id).catch(() => {})
      await Dataset.remove(id).catch(() => {})
    } catch {}
  }
  testIds.length = 0
})

const createMockTrace = (overrides?: Partial<Trace.Complete>): Trace.Complete => ({
  id: "integration-trace-1",
  projectID: "test-project",
  session: {
    id: "test-session",
    projectID: "test-project",
    directory: "/test",
    title: "Test Session",
    version: "1.0.0",
    time: { created: Date.now(), updated: Date.now() },
  },
  messageCount: 3,
  agentName: "gremlin",
  modelConfig: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
  },
  output: "Successfully implemented feature with proper validation",
  toolCalls: [
    { id: "Read", status: "success", duration: 100 } as any,
    { id: "Edit", status: "success", duration: 200 } as any,
  ],
  summary: {
    duration: 1500,
    toolCallCount: 2,
    errorCount: 0,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 20, write: 0 } },
    cost: 0.02,
  },
  evaluationIDs: [],
  createdAt: Date.now(),
  ...overrides,
})

describe("EvalOps Integration - Quality Gates", () => {
  test("enforces quality gate with multiple metrics", async () => {
    // Scenario: Quality gate for production deployment
    const errorRateMetric: Metric.Definition = {
      id: "prod-error-rate",
      name: "Production Error Rate",
      description: "Must have < 5% error rate for production",
      version: "1.0.0",
      category: "reliability",
      evaluator: { type: "heuristic", function: "toolErrorRate" },
      threshold: { pass: 0.05, warn: 0.02 },
      higherIsBetter: false,
      tags: ["production", "gate"],
    }

    const costMetric: Metric.Definition = {
      id: "prod-cost-limit",
      name: "Production Cost Limit",
      description: "Must cost less than $0.05 per execution",
      version: "1.0.0",
      category: "cost",
      evaluator: { type: "heuristic", function: "totalCost" },
      threshold: { pass: 0.05, warn: 0.02 },
      higherIsBetter: false,
      tags: ["production", "gate"],
    }

    testIds.push(errorRateMetric.id, costMetric.id)
    await Metric.register(errorRateMetric)
    await Metric.register(costMetric)

    const trace = createMockTrace()
    const results = await EvaluationEngine.evaluateMany(trace, [errorRateMetric, costMetric])

    // Both gates should pass
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.passed)).toBe(true)

    // Verify results are stored
    const storedResults = await EvaluationEngine.getResults(trace.id)
    expect(storedResults.length).toBeGreaterThanOrEqual(2)
  })

  test("blocks deployment when quality gate fails", async () => {
    const costGateMetric: Metric.Definition = {
      id: "strict-cost-gate",
      name: "Strict Cost Gate",
      description: "Must cost less than $0.01",
      version: "1.0.0",
      category: "cost",
      evaluator: { type: "heuristic", function: "totalCost" },
      threshold: { pass: 0.01 },
      higherIsBetter: false,
      tags: ["gate", "strict"],
    }

    testIds.push(costGateMetric.id)
    await Metric.register(costGateMetric)

    const expensiveTrace = createMockTrace({
      summary: { ...createMockTrace().summary, cost: 0.05 },
    })

    const result = await EvaluationEngine.evaluate(expensiveTrace, costGateMetric)

    // Gate should fail
    expect(result.passed).toBe(false)
    expect(result.score).toBe(0.05)
  })
})

describe("EvalOps Integration - Regression Detection", () => {
  test("detects performance regression across traces", async () => {
    const latencyMetric: Metric.Definition = {
      id: "latency-regression",
      name: "Latency Regression Check",
      description: "Response time must be under 2s",
      version: "1.0.0",
      category: "performance",
      evaluator: { type: "heuristic", function: "responseDuration" },
      threshold: { pass: 2000, warn: 1000 },
      higherIsBetter: false,
      tags: ["regression"],
    }

    testIds.push(latencyMetric.id)
    await Metric.register(latencyMetric)

    // Baseline trace - fast
    const baselineTrace = createMockTrace({
      id: "baseline-trace",
      summary: { ...createMockTrace().summary, duration: 800 },
    })

    // New trace - regressed
    const regressedTrace = createMockTrace({
      id: "regressed-trace",
      summary: { ...createMockTrace().summary, duration: 2500 },
    })

    const baselineResult = await EvaluationEngine.evaluate(baselineTrace, latencyMetric)
    const regressedResult = await EvaluationEngine.evaluate(regressedTrace, latencyMetric)

    expect(baselineResult.passed).toBe(true)
    expect(regressedResult.passed).toBe(false)

    // Verify we can detect the regression
    expect(regressedResult.score).toBeGreaterThan(baselineResult.score)
  })

  test("tracks cost regression over time", async () => {
    const costMetric: Metric.Definition = {
      id: "cost-tracking",
      name: "Cost Tracking",
      description: "Track cost per execution",
      version: "1.0.0",
      category: "cost",
      evaluator: { type: "heuristic", function: "totalCost" },
      threshold: { pass: 0.10 },
      higherIsBetter: false,
      tags: ["monitoring"],
    }

    testIds.push(costMetric.id)
    await Metric.register(costMetric)

    // Simulate multiple executions with increasing cost
    const costs = [0.01, 0.02, 0.03, 0.05, 0.08]
    const results = []

    for (let i = 0; i < costs.length; i++) {
      const trace = createMockTrace({
        id: `cost-trace-${i}`,
        summary: { ...createMockTrace().summary, cost: costs[i] },
      })
      const result = await EvaluationEngine.evaluate(trace, costMetric)
      results.push(result)
    }

    // All should pass the threshold, but we can track the trend
    expect(results.every((r) => r.passed)).toBe(true)
    expect(results[4].score).toBeGreaterThan(results[0].score)
  })
})

describe("EvalOps Integration - Safety & Compliance", () => {
  test("enforces safety constraints with custom rules", async () => {
    const safetyMetric: Metric.Definition = {
      id: "output-safety",
      name: "Output Safety Check",
      description: "Ensures output doesn't contain unsafe content",
      version: "1.0.0",
      category: "safety",
      evaluator: {
        type: "rule",
        expression: '!trace.output.toLowerCase().includes("error") && !trace.output.toLowerCase().includes("failed")',
      },
      threshold: { pass: 1 },
      higherIsBetter: true,
      tags: ["safety", "compliance"],
    }

    testIds.push(safetyMetric.id)
    await Metric.register(safetyMetric)

    const safeTrace = createMockTrace()
    const unsafeTrace = createMockTrace({
      output: "Failed to process the request with error code 500",
    })

    const safeResult = await EvaluationEngine.evaluate(safeTrace, safetyMetric)
    const unsafeResult = await EvaluationEngine.evaluate(unsafeTrace, safetyMetric)

    expect(safeResult.passed).toBe(true)
    expect(safeResult.score).toBe(1)
    expect(unsafeResult.passed).toBe(false)
    expect(unsafeResult.score).toBe(0)
  })

  test("validates guardrail enforcement with assertions", async () => {
    const trace = createMockTrace()

    const guardrailAssertions: Dataset.Assertion[] = [
      { type: "no-errors" },
      { type: "duration-under", milliseconds: 5000 },
      { type: "cost-under", dollars: 0.10 },
      {
        type: "custom",
        expression: "trace.toolCalls.every(tc => tc.status === 'success')",
        description: "All tool calls must succeed",
      },
    ]

    const results = await TestRunner.runAssertions(trace, guardrailAssertions)

    // All guardrails should pass
    expect(results).toHaveLength(4)
    expect(results.every((r) => r.passed)).toBe(true)
  })
})

describe("EvalOps Integration - Test Dataset Workflows", () => {
  test("creates and runs test suite against traces", async () => {
    const dataset: Omit<Dataset.Definition, "createdAt" | "updatedAt"> = {
      id: "integration-test-suite",
      name: "Production Validation Suite",
      description: "Core test cases for production readiness",
      version: "1.0.0",
      testCases: [
        {
          id: "test-1",
          name: "Fast Response Test",
          description: "Should respond in under 2 seconds",
          input: { prompt: "test prompt", context: {} },
          assertions: [{ type: "duration-under", milliseconds: 2000 }],
          tags: ["performance"],
          enabled: true,
        },
        {
          id: "test-2",
          name: "Cost Efficiency Test",
          description: "Should cost less than $0.05",
          input: { prompt: "test prompt", context: {} },
          assertions: [{ type: "cost-under", dollars: 0.05 }],
          tags: ["cost"],
          enabled: true,
        },
        {
          id: "test-3",
          name: "Error-Free Execution",
          description: "Should complete without errors",
          input: { prompt: "test prompt", context: {} },
          assertions: [{ type: "no-errors" }],
          tags: ["reliability"],
          enabled: true,
        },
      ],
      tags: ["integration", "production"],
    }

    testIds.push(dataset.id)
    await Dataset.create(dataset)

    // Verify dataset was created
    const retrieved = await Dataset.get(dataset.id)
    expect(retrieved.testCases).toHaveLength(3)
    expect(retrieved.tags).toContain("integration")

    // Run assertions against a trace
    const trace = createMockTrace()
    const allAssertions = retrieved.testCases.flatMap((tc) => tc.assertions)
    const results = await TestRunner.runAssertions(trace, allAssertions)

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.passed)).toBe(true)
  })

  test("supports dataset versioning and updates", async () => {
    const initialDataset: Omit<Dataset.Definition, "createdAt" | "updatedAt"> = {
      id: "versioned-dataset",
      name: "Versioned Test Suite",
      description: "Initial version",
      version: "1.0.0",
      testCases: [
        {
          id: "v1-test",
          name: "V1 Test",
          description: "Original test",
          input: { prompt: "test", context: {} },
          assertions: [{ type: "no-errors" }],
          tags: [],
          enabled: true,
        },
      ],
      tags: ["v1"],
    }

    testIds.push(initialDataset.id)
    const created = await Dataset.create(initialDataset)

    // Wait 1ms to ensure timestamps are different
    await new Promise(resolve => setTimeout(resolve, 1))

    // Update the dataset
    const updated = await Dataset.update(created.id, {
      version: "2.0.0",
      description: "Updated version with new test",
      tags: ["v2"],
    })

    expect(updated.version).toBe("2.0.0")
    expect(updated.description).toBe("Updated version with new test")
    expect(updated.updatedAt).toBeGreaterThan(created.createdAt)
  })

  test("filters and queries test cases by tags", async () => {
    const dataset: Omit<Dataset.Definition, "createdAt" | "updatedAt"> = {
      id: "tagged-dataset",
      name: "Tagged Test Suite",
      description: "Test suite with tagged cases",
      version: "1.0.0",
      testCases: [
        {
          id: "perf-test",
          name: "Performance Test",
          description: "Performance validation",
          input: { prompt: "test", context: {} },
          assertions: [{ type: "duration-under", milliseconds: 1000 }],
          tags: ["performance", "critical"],
          enabled: true,
        },
        {
          id: "cost-test",
          name: "Cost Test",
          description: "Cost validation",
          input: { prompt: "test", context: {} },
          assertions: [{ type: "cost-under", dollars: 0.01 }],
          tags: ["cost", "optimization"],
          enabled: true,
        },
        {
          id: "experimental-test",
          name: "Experimental Test",
          description: "Experimental feature test",
          input: { prompt: "test", context: {} },
          assertions: [{ type: "no-errors" }],
          tags: ["experimental"],
          enabled: false,
        },
      ],
      tags: ["comprehensive"],
    }

    testIds.push(dataset.id)
    await Dataset.create(dataset)

    // Get only enabled tests
    const enabledTests = await Dataset.getEnabledTestCases(dataset.id)
    expect(enabledTests).toHaveLength(2)
    expect(enabledTests.every((t) => t.enabled)).toBe(true)

    // Verify we can filter by test case tags
    const criticalTests = enabledTests.filter((t) => t.tags.includes("critical"))
    expect(criticalTests).toHaveLength(1)
    expect(criticalTests[0].id).toBe("perf-test")
  })
})

describe("EvalOps Integration - Metric Composition", () => {
  test("evaluates composite quality score from multiple metrics", async () => {
    // Define a comprehensive quality metric suite
    const metrics: Metric.Definition[] = [
      {
        id: "composite-performance",
        name: "Performance Score",
        description: "Latency under 3s",
        version: "1.0.0",
        category: "performance",
        evaluator: { type: "heuristic", function: "responseDuration" },
        threshold: { pass: 3000 },
        higherIsBetter: false,
        tags: ["composite"],
      },
      {
        id: "composite-reliability",
        name: "Reliability Score",
        description: "No errors",
        version: "1.0.0",
        category: "reliability",
        evaluator: { type: "heuristic", function: "hasErrors" },
        threshold: { pass: 0 },
        higherIsBetter: false,
        tags: ["composite"],
      },
      {
        id: "composite-efficiency",
        name: "Token Efficiency Score",
        description: "Efficient token usage",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "tokenEfficiency" },
        threshold: { pass: 0.2 },
        higherIsBetter: true,
        tags: ["composite"],
      },
    ]

    for (const metric of metrics) {
      testIds.push(metric.id)
      await Metric.register(metric)
    }

    const trace = createMockTrace()
    const results = await EvaluationEngine.evaluateMany(trace, metrics)

    // Calculate composite score
    const passedCount = results.filter((r) => r.passed).length
    const compositeScore = passedCount / results.length

    expect(results).toHaveLength(3)
    expect(compositeScore).toBeGreaterThanOrEqual(0.66) // At least 2/3 should pass
  })

  test("summarizes evaluation results with statistics", async () => {
    const metric: Metric.Definition = {
      id: "summary-metric",
      name: "Summary Test Metric",
      description: "For testing summary statistics",
      version: "1.0.0",
      category: "performance",
      evaluator: { type: "heuristic", function: "toolSuccessRate" },
      threshold: { pass: 0.8 },
      higherIsBetter: true,
      tags: ["summary"],
    }

    testIds.push(metric.id)
    await Metric.register(metric)

    // Create multiple traces with varying success rates
    const traces = [
      createMockTrace({
        id: "trace-1",
        toolCalls: [
          { id: "Read", status: "success", duration: 100 } as any,
          { id: "Edit", status: "success", duration: 200 } as any,
        ],
      }),
      createMockTrace({
        id: "trace-2",
        toolCalls: [
          { id: "Read", status: "success", duration: 100 } as any,
          { id: "Edit", status: "error", duration: 200 } as any,
        ],
      }),
      createMockTrace({
        id: "trace-3",
        toolCalls: [
          { id: "Read", status: "success", duration: 100 } as any,
          { id: "Edit", status: "success", duration: 200 } as any,
          { id: "Create", status: "success", duration: 150 } as any,
        ],
      }),
    ]

    for (const trace of traces) {
      await EvaluationEngine.evaluate(trace, metric)
    }

    // Get summary for first trace
    const summary = await EvaluationEngine.summarize(traces[0].id)

    expect(summary.total).toBeGreaterThanOrEqual(1)
    expect(summary.passed + summary.failed).toBe(summary.total)
    expect(summary.averageScore).toBeGreaterThan(0)
  })
})

describe("EvalOps Integration - Production Monitoring", () => {
  test("tracks cache hit rate for cost optimization", async () => {
    const cacheMetric: Metric.Definition = {
      id: "cache-monitoring",
      name: "Cache Hit Rate Monitor",
      description: "Track cache efficiency",
      version: "1.0.0",
      category: "cost",
      evaluator: { type: "heuristic", function: "cacheHitRate" },
      threshold: { pass: 0.2, warn: 0.4 },
      higherIsBetter: true,
      tags: ["monitoring", "optimization"],
    }

    testIds.push(cacheMetric.id)
    await Metric.register(cacheMetric)

    const goodCacheTrace = createMockTrace({
      summary: {
        ...createMockTrace().summary,
        tokens: { input: 60, output: 50, reasoning: 0, cache: { read: 40, write: 0 } },
      },
    })

    const result = await EvaluationEngine.evaluate(goodCacheTrace, cacheMetric)

    expect(result.passed).toBe(true)
    expect(result.score).toBe(0.4) // 40 / (60 + 40) = 0.4
  })

  test("monitors tool usage patterns", async () => {
    const trace = createMockTrace({
      toolCalls: [
        { id: "Read", status: "success", duration: 100 } as any,
        { id: "Read", status: "success", duration: 120 } as any,
        { id: "Read", status: "success", duration: 130 } as any,
        { id: "Edit", status: "success", duration: 200 } as any,
        { id: "Execute", status: "success", duration: 300 } as any,
      ],
    })

    const assertions: Dataset.Assertion[] = [
      { type: "tool-called", toolID: "Read", minCount: 1, maxCount: 3 },
      { type: "tool-called", toolID: "Edit", minCount: 1 },
      {
        type: "custom",
        expression: "trace.toolCalls.filter(t => t.id === 'Read').length <= 2",
        description: "Should not overuse Read tool",
      },
    ]

    const results = await TestRunner.runAssertions(trace, assertions)

    expect(results).toHaveLength(3)
    expect(results.filter((r) => r.passed).length).toBe(2) // First two pass, third fails (3 Read calls > 2)
  })
})
