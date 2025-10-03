import { describe, expect, test, beforeEach } from "bun:test"
import { Baseline } from "../../src/evaluation/baseline"
import { Metric } from "../../src/evaluation/metric"
import type { Trace } from "../../src/trace"

const testIds: string[] = []

beforeEach(async () => {
  for (const id of testIds) {
    try {
      await Baseline.remove(id).catch(() => {})
      await Metric.remove(id).catch(() => {})
    } catch {}
  }
  testIds.length = 0
})

const createMockTrace = (overrides?: Partial<Trace.Complete>): Trace.Complete => ({
  id: `trace-${Date.now()}-${Math.random()}`,
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
  agentName: "test-agent",
  modelConfig: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
  },
  output: "Test output",
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

describe("Baseline", () => {
  describe("create and get", () => {
    test("can create and retrieve a baseline", async () => {
      const baseline = await Baseline.create({
        id: "test-baseline",
        name: "Test Baseline",
        description: "A test baseline",
        metricIDs: ["metric-1"],
        tags: ["test"],
      })

      testIds.push(baseline.id)

      expect(baseline.id).toBe("test-baseline")
      expect(baseline.name).toBe("Test Baseline")
      expect(baseline.createdAt).toBeGreaterThan(0)

      const retrieved = await Baseline.get(baseline.id)
      expect(retrieved.id).toBe(baseline.id)
    })

    test("initializes with default values", async () => {
      const baseline = await Baseline.create({
        id: "defaults-test",
        name: "Defaults",
        description: "Test defaults",
        metricIDs: [],
      })

      testIds.push(baseline.id)

      expect(baseline.traceIDs).toEqual([])
      expect(baseline.statistics).toEqual([])
      expect(baseline.minSampleSize).toBe(10)
      expect(baseline.regressionThreshold).toBe(0.1)
    })
  })

  describe("list and findByTag", () => {
    test("lists all baselines", async () => {
      const b1 = await Baseline.create({
        id: "baseline-1",
        name: "Baseline 1",
        description: "First",
        metricIDs: [],
      })
      testIds.push(b1.id)

      const b2 = await Baseline.create({
        id: "baseline-2",
        name: "Baseline 2",
        description: "Second",
        metricIDs: [],
      })
      testIds.push(b2.id)

      const list = await Baseline.list()
      expect(list.length).toBeGreaterThanOrEqual(2)
      expect(list.some((b) => b.id === "baseline-1")).toBe(true)
      expect(list.some((b) => b.id === "baseline-2")).toBe(true)
    })

    test("finds baselines by tag", async () => {
      const b1 = await Baseline.create({
        id: "prod-baseline",
        name: "Production",
        description: "Prod baseline",
        metricIDs: [],
        tags: ["production", "v1"],
      })
      testIds.push(b1.id)

      const b2 = await Baseline.create({
        id: "dev-baseline",
        name: "Development",
        description: "Dev baseline",
        metricIDs: [],
        tags: ["development"],
      })
      testIds.push(b2.id)

      const prodBaselines = await Baseline.findByTag("production")
      expect(prodBaselines.length).toBeGreaterThanOrEqual(1)
      expect(prodBaselines.some((b) => b.id === "prod-baseline")).toBe(true)
      expect(prodBaselines.every((b) => b.tags.includes("production"))).toBe(true)
    })
  })

  describe("addTrace", () => {
    test("adds trace to baseline and updates statistics", async () => {
      // Create metric
      const metric: Metric.Definition = {
        id: "test-metric",
        name: "Test Metric",
        description: "Test",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create baseline
      const baseline = await Baseline.create({
        id: "baseline-with-traces",
        name: "Baseline with Traces",
        description: "Test baseline",
        metricIDs: [metric.id],
        minSampleSize: 2,
      })
      testIds.push(baseline.id)

      // Add traces
      const trace1 = createMockTrace({ cost: 0.01 } as any)
      const trace2 = createMockTrace({ cost: 0.02 } as any)

      await Baseline.addTrace(baseline.id, trace1)
      await Baseline.addTrace(baseline.id, trace2)

      const updated = await Baseline.get(baseline.id)
      expect(updated.traceIDs).toHaveLength(2)
      expect(updated.statistics.length).toBeGreaterThan(0)
    })
  })

  describe("compare", () => {
    test("compares trace against baseline and detects regressions", async () => {
      // Create metric (lower is better)
      const metric: Metric.Definition = {
        id: "error-rate-metric",
        name: "Error Rate",
        description: "Tool error rate",
        version: "1.0.0",
        category: "reliability",
        evaluator: { type: "heuristic", function: "toolErrorRate" },
        threshold: { pass: 0.1 },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create baseline with good traces
      const baseline = await Baseline.create({
        id: "compare-baseline",
        name: "Compare Baseline",
        description: "For comparison tests",
        metricIDs: [metric.id],
        minSampleSize: 3,
        regressionThreshold: 0.2, // 20% threshold
      })
      testIds.push(baseline.id)

      // Add baseline traces with low error rate
      for (let i = 0; i < 3; i++) {
        const trace = createMockTrace({
          toolCalls: [
            { id: "Read", status: "success", duration: 100 } as any,
            { id: "Edit", status: "success", duration: 200 } as any,
            { id: "Execute", status: "success", duration: 150 } as any,
          ],
        })
        await Baseline.addTrace(baseline.id, trace)
      }

      // Compare against a trace with high error rate
      const badTrace = createMockTrace({
        toolCalls: [
          { id: "Read", status: "error", duration: 100 } as any,
          { id: "Edit", status: "error", duration: 200 } as any,
          { id: "Execute", status: "success", duration: 150 } as any,
        ],
      })

      const comparison = await Baseline.compare(baseline.id, badTrace)

      expect(comparison.baselineID).toBe(baseline.id)
      expect(comparison.traceID).toBe(badTrace.id)
      expect(comparison.metrics.length).toBeGreaterThan(0)
      
      // Should detect regression (error rate went up significantly)
      const metricComparison = comparison.metrics.find((m) => m.metricID === metric.id)
      expect(metricComparison).toBeDefined()
      expect(metricComparison!.isRegression).toBe(true)
      expect(comparison.regressions).toContain(metric.id)
    })

    test("detects improvements", async () => {
      const metric: Metric.Definition = {
        id: "success-rate-metric",
        name: "Success Rate",
        description: "Tool success rate",
        version: "1.0.0",
        category: "reliability",
        evaluator: { type: "heuristic", function: "toolSuccessRate" },
        higherIsBetter: true,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const baseline = await Baseline.create({
        id: "improvement-baseline",
        name: "Improvement Baseline",
        description: "Test improvements",
        metricIDs: [metric.id],
        minSampleSize: 2,
        regressionThreshold: 0.1,
      })
      testIds.push(baseline.id)

      // Add baseline traces with 50% success rate
      for (let i = 0; i < 2; i++) {
        const trace = createMockTrace({
          toolCalls: [
            { id: "Read", status: "success", duration: 100 } as any,
            { id: "Edit", status: "error", duration: 200 } as any,
          ],
        })
        await Baseline.addTrace(baseline.id, trace)
      }

      // Compare against a trace with 100% success rate
      const goodTrace = createMockTrace({
        toolCalls: [
          { id: "Read", status: "success", duration: 100 } as any,
          { id: "Edit", status: "success", duration: 200 } as any,
        ],
      })

      const comparison = await Baseline.compare(baseline.id, goodTrace)
      expect(comparison.improvements.length).toBeGreaterThan(0)
    })
  })

  describe("compareAB", () => {
    test("compares two baselines for A/B testing", async () => {
      const metric: Metric.Definition = {
        id: "ab-test-metric",
        name: "AB Test Metric",
        description: "For AB testing",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create baseline A (higher cost)
      const baselineA = await Baseline.create({
        id: "baseline-a",
        name: "Baseline A",
        description: "Version A",
        metricIDs: [metric.id],
        minSampleSize: 3,
      })
      testIds.push(baselineA.id)

      for (let i = 0; i < 3; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1500,
            toolCallCount: 2,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.05, // Higher cost
          },
        })
        await Baseline.addTrace(baselineA.id, trace)
      }

      // Create baseline B (lower cost)
      const baselineB = await Baseline.create({
        id: "baseline-b",
        name: "Baseline B",
        description: "Version B",
        metricIDs: [metric.id],
        minSampleSize: 3,
      })
      testIds.push(baselineB.id)

      for (let i = 0; i < 3; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1500,
            toolCallCount: 2,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.02, // Lower cost
          },
        })
        await Baseline.addTrace(baselineB.id, trace)
      }

      const abResult = await Baseline.compareAB(baselineA.id, baselineB.id)

      expect(abResult.baselineA).toBe(baselineA.id)
      expect(abResult.baselineB).toBe(baselineB.id)
      expect(abResult.metrics.length).toBeGreaterThan(0)
      expect(abResult.overallWinner).toBe("B") // B has lower cost
      expect(abResult.sampleSizeA).toBe(3)
      expect(abResult.sampleSizeB).toBe(3)

      const metricComparison = abResult.metrics[0]
      expect(metricComparison.metricID).toBe(metric.id)
      expect(metricComparison.winner).toBe("B")
      expect(metricComparison.meanB).toBeLessThan(metricComparison.meanA)
    })
  })
})
