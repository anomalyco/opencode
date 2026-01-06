import { describe, test, expect } from "bun:test"
import { BenchmarkMetrics } from "../../src/benchmark/metrics"
import { RefactorTask } from "../../src/benchmark/tasks/refactor"
import fs from "fs/promises"

describe("BenchmarkMetrics", () => {
  test("generateBenchmarkId creates unique IDs", () => {
    const id1 = BenchmarkMetrics.generateBenchmarkId()
    const id2 = BenchmarkMetrics.generateBenchmarkId()

    expect(id1).toMatch(/^benchmark_\d+_[a-z0-9]+$/)
    expect(id2).toMatch(/^benchmark_\d+_[a-z0-9]+$/)
    expect(id1).not.toBe(id2)
  })

  test("generateRunId creates unique IDs with method prefix", () => {
    const hybridId = BenchmarkMetrics.generateRunId("hybrid")
    const legacyId = BenchmarkMetrics.generateRunId("legacy")

    expect(hybridId).toMatch(/^run_hybrid_\d+_[a-z0-9]+$/)
    expect(legacyId).toMatch(/^run_legacy_\d+_[a-z0-9]+$/)
  })

  test("createRunMetrics initializes with correct defaults", () => {
    const metrics = BenchmarkMetrics.createRunMetrics({
      run_id: "test_run",
      task: "test task",
      model: "test/model",
    })

    expect(metrics.run_id).toBe("test_run")
    expect(metrics.task).toBe("test task")
    expect(metrics.model).toBe("test/model")
    expect(metrics.started_at).toBeGreaterThan(0)
    expect(metrics.completed_at).toBe(0)
    expect(metrics.total_compactions).toBe(0)
    expect(metrics.compactions).toEqual([])
    expect(metrics.task_completed).toBe(false)
  })

  test("compareRuns calculates token savings correctly", () => {
    const hybrid: BenchmarkMetrics.RunMetrics = {
      run_id: "hybrid",
      task: "test",
      model: "test",
      started_at: 1000,
      completed_at: 2000,
      total_compactions: 1,
      compactions: [
        {
          method: "hybrid",
          timestamp: 1000,
          duration_ms: 500,
          tokens: { input: 100, output: 50, total: 150 },
          original_context_tokens: 1000,
          compacted_context_tokens: 200,
          compression_ratio: 0.8,
          output_text: "hybrid output",
        },
      ],
      task_completed: true,
    }

    const legacy: BenchmarkMetrics.RunMetrics = {
      run_id: "legacy",
      task: "test",
      model: "test",
      started_at: 1000,
      completed_at: 2000,
      total_compactions: 1,
      compactions: [
        {
          method: "legacy",
          timestamp: 1000,
          duration_ms: 600,
          tokens: { input: 120, output: 80, total: 200 },
          original_context_tokens: 1000,
          compacted_context_tokens: 300,
          compression_ratio: 0.7,
          output_text: "legacy output",
        },
      ],
      task_completed: true,
    }

    const comparison = BenchmarkMetrics.compareRuns(hybrid, legacy)

    // 150 vs 200 tokens = 25% savings
    expect(comparison.token_savings_percent).toBe(25)
    // 500ms vs 600ms = ~16.67% savings
    expect(comparison.time_savings_percent).toBeCloseTo(16.67, 1)
    expect(comparison.winner).toBe("hybrid")
  })

  test("compareRuns returns tie when differences are small", () => {
    const hybrid: BenchmarkMetrics.RunMetrics = {
      run_id: "hybrid",
      task: "test",
      model: "test",
      started_at: 1000,
      completed_at: 2000,
      total_compactions: 1,
      compactions: [
        {
          method: "hybrid",
          timestamp: 1000,
          duration_ms: 500,
          tokens: { input: 100, output: 50, total: 150 },
          original_context_tokens: 1000,
          compacted_context_tokens: 200,
          compression_ratio: 0.8,
          output_text: "hybrid output",
        },
      ],
      task_completed: true,
    }

    const legacy: BenchmarkMetrics.RunMetrics = {
      run_id: "legacy",
      task: "test",
      model: "test",
      started_at: 1000,
      completed_at: 2000,
      total_compactions: 1,
      compactions: [
        {
          method: "legacy",
          timestamp: 1000,
          duration_ms: 510, // Very similar
          tokens: { input: 98, output: 52, total: 150 }, // Same total
          original_context_tokens: 1000,
          compacted_context_tokens: 200,
          compression_ratio: 0.8,
          output_text: "legacy output",
        },
      ],
      task_completed: true,
    }

    const comparison = BenchmarkMetrics.compareRuns(hybrid, legacy)
    expect(comparison.winner).toBe("tie")
  })
})

describe("RefactorTask", () => {
  test("setup creates temporary directory with files", async () => {
    const dir = await RefactorTask.setup()

    try {
      // Check that key files exist
      const indexFile = await fs.readFile(`${dir}/src/index.ts`, "utf-8")
      expect(indexFile).toContain("getData")
      expect(indexFile).toContain("validateEmail")

      const helpersFile = await fs.readFile(`${dir}/src/utils/helpers.ts`, "utf-8")
      expect(helpersFile).toContain("function validateEmail")
      expect(helpersFile).toContain("function validateAge")
      expect(helpersFile).toContain("function validateName")

      // Check tsconfig exists
      const tsconfig = await fs.readFile(`${dir}/tsconfig.json`, "utf-8")
      expect(JSON.parse(tsconfig)).toHaveProperty("compilerOptions")
    } finally {
      await RefactorTask.cleanup(dir)
    }
  })

  test("cleanup removes directory", async () => {
    const dir = await RefactorTask.setup()
    await RefactorTask.cleanup(dir)

    const exists = await fs
      .access(dir)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  test("verify detects incomplete refactoring", async () => {
    const dir = await RefactorTask.setup()

    try {
      // Without any changes, verification should fail
      const result = await RefactorTask.verify(dir)
      expect(result.success).toBe(false)
      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues).toContain("utils/validation.ts was not created")
    } finally {
      await RefactorTask.cleanup(dir)
    }
  })

  test("TASK_PROMPT contains required instructions", () => {
    expect(RefactorTask.TASK_PROMPT).toContain("getData")
    expect(RefactorTask.TASK_PROMPT).toContain("fetchUserData")
    expect(RefactorTask.TASK_PROMPT).toContain("validation.ts")
    expect(RefactorTask.TASK_PROMPT).toContain("TypeScript types")
  })
})
