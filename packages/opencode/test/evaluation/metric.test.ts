import { describe, expect, test, beforeEach } from "bun:test"
import { Metric } from "../../src/evaluation/metric"

// Clean up test metrics after each test
const testMetricIds: string[] = []

beforeEach(async () => {
  // Clean up any test metrics from previous runs
  for (const id of testMetricIds) {
    try {
      await Metric.remove(id)
    } catch {}
  }
  testMetricIds.length = 0
})

describe("Metric", () => {
  describe("register and get", () => {
    test("can register and retrieve a metric", async () => {
      const metric: Metric.Definition = {
        id: "test-metric-1",
        name: "Test Metric",
        description: "A test metric",
        version: "1.0.0",
        category: "performance",
        evaluator: {
          type: "heuristic",
          function: "toolErrorRate",
        },
        threshold: {
          pass: 0.1,
        },
        higherIsBetter: false,
        tags: ["test"],
      }

      testMetricIds.push(metric.id)
      await Metric.register(metric)

      const retrieved = await Metric.get(metric.id)
      expect(retrieved).toEqual(metric)
    })
  })

  describe("exists", () => {
    test("returns true for existing metric", async () => {
      const metric: Metric.Definition = {
        id: "test-metric-exists",
        name: "Test",
        description: "Test",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }

      testMetricIds.push(metric.id)
      await Metric.register(metric)

      expect(await Metric.exists(metric.id)).toBe(true)
    })

    test("returns false for non-existing metric", async () => {
      expect(await Metric.exists("non-existing-metric")).toBe(false)
    })
  })

  describe("list", () => {
    test("returns all registered metrics", async () => {
      const metric1: Metric.Definition = {
        id: "test-list-1",
        name: "Metric 1",
        description: "Test",
        version: "1.0.0",
        category: "performance",
        evaluator: { type: "heuristic", function: "responseDuration" },
        higherIsBetter: false,
        tags: [],
      }

      const metric2: Metric.Definition = {
        id: "test-list-2",
        name: "Metric 2",
        description: "Test",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }

      testMetricIds.push(metric1.id, metric2.id)
      await Metric.register(metric1)
      await Metric.register(metric2)

      const all = await Metric.list()
      const testMetrics = all.filter((m) => m.id.startsWith("test-list-"))

      expect(testMetrics.length).toBeGreaterThanOrEqual(2)
      expect(testMetrics.some((m) => m.id === metric1.id)).toBe(true)
      expect(testMetrics.some((m) => m.id === metric2.id)).toBe(true)
    })
  })

  describe("findByCategory", () => {
    test("filters metrics by category", async () => {
      const perfMetric: Metric.Definition = {
        id: "test-cat-perf",
        name: "Performance Metric",
        description: "Test",
        version: "1.0.0",
        category: "performance",
        evaluator: { type: "heuristic", function: "responseDuration" },
        higherIsBetter: false,
        tags: [],
      }

      const costMetric: Metric.Definition = {
        id: "test-cat-cost",
        name: "Cost Metric",
        description: "Test",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }

      testMetricIds.push(perfMetric.id, costMetric.id)
      await Metric.register(perfMetric)
      await Metric.register(costMetric)

      const perfMetrics = await Metric.findByCategory("performance")
      const testPerfMetrics = perfMetrics.filter((m) => m.id.startsWith("test-cat-"))

      expect(testPerfMetrics.some((m) => m.id === perfMetric.id)).toBe(true)
      expect(testPerfMetrics.some((m) => m.id === costMetric.id)).toBe(false)
    })
  })

  describe("findByTag", () => {
    test("filters metrics by tag", async () => {
      const metric1: Metric.Definition = {
        id: "test-tag-1",
        name: "Tagged Metric 1",
        description: "Test",
        version: "1.0.0",
        category: "performance",
        evaluator: { type: "heuristic", function: "responseDuration" },
        higherIsBetter: false,
        tags: ["important", "production"],
      }

      const metric2: Metric.Definition = {
        id: "test-tag-2",
        name: "Tagged Metric 2",
        description: "Test",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: ["experimental"],
      }

      testMetricIds.push(metric1.id, metric2.id)
      await Metric.register(metric1)
      await Metric.register(metric2)

      const importantMetrics = await Metric.findByTag("important")
      const testImportantMetrics = importantMetrics.filter((m) => m.id.startsWith("test-tag-"))

      expect(testImportantMetrics.some((m) => m.id === metric1.id)).toBe(true)
      expect(testImportantMetrics.some((m) => m.id === metric2.id)).toBe(false)
    })
  })

  describe("remove", () => {
    test("removes a metric", async () => {
      const metric: Metric.Definition = {
        id: "test-remove",
        name: "To Remove",
        description: "Test",
        version: "1.0.0",
        category: "performance",
        evaluator: { type: "heuristic", function: "responseDuration" },
        higherIsBetter: false,
        tags: [],
      }

      await Metric.register(metric)
      expect(await Metric.exists(metric.id)).toBe(true)

      await Metric.remove(metric.id)
      expect(await Metric.exists(metric.id)).toBe(false)
    })
  })
})
