import { describe, expect, test } from "bun:test"
import { buildDisplayDiff, LARGE_FILE_DIFF_BYTES } from "../../src/tool/edit"

describe("buildDisplayDiff", () => {
  test("returns a non-truncated unified diff for small files", () => {
    const result = buildDisplayDiff("/tmp/a.txt", "line one\nline two\n", "line one\nLINE TWO\n")
    expect(result.truncated).toBe(false)
    expect(result.diff).toContain("+LINE TWO")
    expect(result.diff).toContain("-line two")
    expect(result.additions).toBeGreaterThan(0)
    expect(result.deletions).toBeGreaterThan(0)
  })

  test("truncates when old content exceeds threshold", () => {
    const old = "x\n".repeat(LARGE_FILE_DIFF_BYTES)
    const result = buildDisplayDiff("/tmp/big.txt", old, "y\n")
    expect(result.truncated).toBe(true)
    expect(result.diff).toBe("")
    expect(result.deletions).toBeGreaterThan(0)
  })

  test("truncates when new content exceeds threshold", () => {
    const next = "y\n".repeat(LARGE_FILE_DIFF_BYTES)
    const result = buildDisplayDiff("/tmp/big.txt", "x\n", next)
    expect(result.truncated).toBe(true)
    expect(result.diff).toBe("")
    expect(result.additions).toBeGreaterThan(0)
  })

  test("boundary: content exactly at threshold is still diffed", () => {
    const old = "a".repeat(LARGE_FILE_DIFF_BYTES - 1)
    const next = old + "b"
    const result = buildDisplayDiff("/tmp/boundary.txt", old, next)
    expect(result.truncated).toBe(false)
    expect(result.diff.length).toBeGreaterThan(0)
  })

  test("completes quickly for very large divergent rewrites", () => {
    const old = "a".repeat(5 * 1024 * 1024)
    const next = "b".repeat(5 * 1024 * 1024)
    const start = performance.now()
    const result = buildDisplayDiff("/tmp/huge.txt", old, next)
    const elapsed = performance.now() - start
    expect(result.truncated).toBe(true)
    expect(elapsed).toBeLessThan(200)
  })
})
