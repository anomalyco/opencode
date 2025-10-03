import { describe, expect, test } from "bun:test"
import { Baseline } from "../../src/evaluation/baseline"
import { Metric } from "../../src/evaluation/metric"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Trace } from "../../src/trace"

// Helper to wrap tests with Instance context for storage isolation
async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn,
  })
}

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
      await withInstance(async () => {
        const baseline = await Baseline.create({
          id: "test-baseline",
          name: "Test Baseline",
          description: "A test baseline",
          metricIDs: ["metric-1"],
          tags: ["test"],
        })

        expect(baseline.id).toBe("test-baseline")
        expect(baseline.name).toBe("Test Baseline")
        expect(baseline.createdAt).toBeGreaterThan(0)

        const retrieved = await Baseline.get(baseline.id)
        expect(retrieved.id).toBe(baseline.id)
      })
    })

    test("initializes with default values", async () => {
      await withInstance(async () => {
        const baseline = await Baseline.create({
          id: "defaults-test",
          name: "Defaults",
          description: "Test defaults",
          metricIDs: [],
        })

        expect(baseline.traceIDs).toEqual([])
        expect(baseline.statistics).toEqual([])
        expect(baseline.minSampleSize).toBe(10)
        expect(baseline.regressionThreshold).toBe(0.1)
      })
    })
  })

  describe("list and findByTag", () => {
    test("lists all baselines", async () => {
      await withInstance(async () => {
        const b1 = await Baseline.create({
          id: "baseline-1",
          name: "Baseline 1",
          description: "First",
          metricIDs: [],
        })

        const b2 = await Baseline.create({
          id: "baseline-2",
          name: "Baseline 2",
          description: "Second",
          metricIDs: [],
        })

        const list = await Baseline.list()
        expect(list.length).toBeGreaterThanOrEqual(2)
        expect(list.some((b) => b.id === b1.id)).toBe(true)
        expect(list.some((b) => b.id === b2.id)).toBe(true)
      })
    })

    test("finds baselines by tag", async () => {
      await withInstance(async () => {
        await Baseline.create({
          id: "prod-baseline",
          name: "Production",
          description: "Prod baseline",
          metricIDs: [],
          tags: ["production", "v1"],
        })

        await Baseline.create({
          id: "dev-baseline",
          name: "Development",
          description: "Dev baseline",
          metricIDs: [],
          tags: ["development"],
        })

        const prodBaselines = await Baseline.findByTag("production")
        expect(prodBaselines.length).toBeGreaterThanOrEqual(1)
        expect(prodBaselines.every((b) => b.tags.includes("production"))).toBe(true)
      })
    })
  })

  describe("addTrace", () => {
    test("adds trace to baseline and updates statistics", async () => {
      await withInstance(async () => {
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

        const baseline = await Baseline.create({
          id: "baseline-with-traces",
          name: "Baseline with Traces",
          description: "Test baseline",
          metricIDs: [metric.id],
          minSampleSize: 2,
        })

        const trace1 = createMockTrace({ cost: 0.01 } as any)
        const trace2 = createMockTrace({ cost: 0.02 } as any)

        await Baseline.addTrace(baseline.id, trace1)
        await Baseline.addTrace(baseline.id, trace2)

        const updated = await Baseline.get(baseline.id)
        expect(updated.traceIDs).toHaveLength(2)
        expect(updated.statistics.length).toBeGreaterThan(0)
      })
    })
  })

  describe("compare", () => {
    test("compares trace against baseline and detects regressions", async () => {
      await withInstance(async () => {
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

        const baseline = await Baseline.create({
          id: "compare-baseline",
          name: "Compare Baseline",
          description: "For comparison tests",
          metricIDs: [metric.id],
          minSampleSize: 3,
          regressionThreshold: 0.2,
        })

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
        const metricComparison = comparison.metrics.find((m) => m.metricID === metric.id)
        expect(metricComparison).toBeDefined()
        expect(metricComparison!.isRegression).toBe(true)
        expect(comparison.regressions).toContain(metric.id)
      })
    })

    test("detects improvements", async () => {
      await withInstance(async () => {
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

        const baseline = await Baseline.create({
          id: "improvement-baseline",
          name: "Improvement Baseline",
          description: "Test improvements",
          metricIDs: [metric.id],
          minSampleSize: 2,
          regressionThreshold: 0.1,
        })

        for (let i = 0; i < 2; i++) {
          const trace = createMockTrace({
            toolCalls: [
              { id: "Read", status: "success", duration: 100 } as any,
              { id: "Edit", status: "error", duration: 200 } as any,
            ],
          })
          await Baseline.addTrace(baseline.id, trace)
        }

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
  })

  describe("compareAB", () => {
    test("compares two baselines for A/B testing", async () => {
      await withInstance(async () => {
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

        const baselineA = await Baseline.create({
          id: "baseline-a",
          name: "Baseline A",
          description: "Version A",
          metricIDs: [metric.id],
          minSampleSize: 3,
        })

        for (let i = 0; i < 3; i++) {
          const trace = createMockTrace({
            summary: {
              duration: 1500,
              toolCallCount: 2,
              errorCount: 0,
              tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
              cost: 0.05,
            },
          })
          await Baseline.addTrace(baselineA.id, trace)
        }

        const baselineB = await Baseline.create({
          id: "baseline-b",
          name: "Baseline B",
          description: "Version B",
          metricIDs: [metric.id],
          minSampleSize: 3,
        })

        for (let i = 0; i < 3; i++) {
          const trace = createMockTrace({
            summary: {
              duration: 1500,
              toolCallCount: 2,
              errorCount: 0,
              tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
              cost: 0.02,
            },
          })
          await Baseline.addTrace(baselineB.id, trace)
        }

        const abResult = await Baseline.compareAB(baselineA.id, baselineB.id)

        expect(abResult.baselineA).toBe(baselineA.id)
        expect(abResult.baselineB).toBe(baselineB.id)
        expect(abResult.metrics.length).toBeGreaterThan(0)
        expect(abResult.overallWinner).toBe("B")
        expect(abResult.sampleSizeA).toBe(3)
        expect(abResult.sampleSizeB).toBe(3)

        const metricComparison = abResult.metrics[0]
        expect(metricComparison.metricID).toBe(metric.id)
        expect(metricComparison.winner).toBe("B")
        expect(metricComparison.meanB).toBeLessThan(metricComparison.meanA)
      })
    })
  })
})
