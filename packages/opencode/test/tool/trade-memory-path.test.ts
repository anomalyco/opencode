import { describe, expect, test } from "bun:test"
import { resolveIndexDbPath } from "../../../../.opencode/trade-memory-core/db"

describe("trade-memory path resolution", () => {
  test("uses the canonical default when path is omitted", () => {
    expect(resolveIndexDbPath(undefined)).toBe(resolveIndexDbPath(""))
  })

  test("uses the canonical default when path is whitespace only", () => {
    expect(resolveIndexDbPath("   ")).toBe(resolveIndexDbPath(undefined))
  })

  test("trims explicit paths before opening SQLite", () => {
    expect(resolveIndexDbPath("  /tmp/trade-memory.sqlite3  ")).toBe("/tmp/trade-memory.sqlite3")
  })
})
