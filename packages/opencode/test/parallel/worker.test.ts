import { describe, expect, test } from "bun:test"
import { WorkerManager } from "../../src/parallel/worker"

describe("WorkerManager stall detection", () => {
  test("retries structural workers that make no meaningful changes quickly", () => {
    const result = WorkerManager.detectStalledProgress({
      kind: "structural",
      elapsedMs: 80_000,
      changedMs: 80_000,
      baseline: { fingerprint: "", files: 0, additions: 0, deletions: 0, score: 0 },
      current: { fingerprint: "", files: 0, additions: 0, deletions: 0, score: 0 },
      timeoutMs: 30 * 60 * 1000,
    })

    expect(result).toContain("no meaningful filesystem changes")
  })

  test("does not retry semantic workers too early", () => {
    const result = WorkerManager.detectStalledProgress({
      kind: "semantic",
      elapsedMs: 80_000,
      changedMs: 80_000,
      baseline: { fingerprint: "", files: 0, additions: 0, deletions: 0, score: 0 },
      current: { fingerprint: "", files: 0, additions: 0, deletions: 0, score: 0 },
      timeoutMs: 30 * 60 * 1000,
    })

    expect(result).toBeUndefined()
  })

  test("retries when initial edits stop progressing", () => {
    const result = WorkerManager.detectStalledProgress({
      kind: "structural",
      elapsedMs: 120_000,
      changedMs: 50_000,
      baseline: { fingerprint: "", files: 0, additions: 0, deletions: 0, score: 0 },
      current: {
        fingerprint: "M src/a.ts|1|1|0",
        files: 1,
        additions: 1,
        deletions: 0,
        score: 21,
      },
      timeoutMs: 30 * 60 * 1000,
    })

    expect(result).toContain("stopped progressing")
  })

  test("does not retry while progress is still moving", () => {
    const result = WorkerManager.detectStalledProgress({
      kind: "structural",
      elapsedMs: 120_000,
      changedMs: 10_000,
      baseline: { fingerprint: "", files: 0, additions: 0, deletions: 0, score: 0 },
      current: {
        fingerprint: "M src/a.ts|1|4|0",
        files: 1,
        additions: 4,
        deletions: 0,
        score: 24,
      },
      timeoutMs: 30 * 60 * 1000,
    })

    expect(result).toBeUndefined()
  })
})
