import { describe, expect, test } from "bun:test"
import { fileContentCacheKey } from "./file-cache-key"

describe("fileContentCacheKey", () => {
  test("keeps identical path and contents stable", () => {
    const first = fileContentCacheKey(".trellis/tasks/demo/prd.md", "line one\nline two\n")
    const second = fileContentCacheKey(".trellis/tasks/demo/prd.md", "line one\nline two\n")

    expect(second).toBe(first)
  })

  test("changes when the same path reloads with different contents", () => {
    const before = fileContentCacheKey(".trellis/tasks/demo/prd.md", "old\n")
    const after = fileContentCacheKey(".trellis/tasks/demo/prd.md", "old\nnew\n")

    expect(after).not.toBe(before)
  })
})
