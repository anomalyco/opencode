import { describe, expect, test } from "bun:test"
import { assertTrustedDbPath, resolveIndexDbPath, resolveSourceDbPath } from "../../../../.opencode/trade-memory-core/db"

describe("trade-memory path resolution", () => {
  test("uses the canonical default when path is omitted", () => {
    expect(resolveIndexDbPath(undefined)).toBe(resolveIndexDbPath(""))
  })

  test("uses the canonical default when path is whitespace only", () => {
    expect(resolveIndexDbPath("   ")).toBe(resolveIndexDbPath(undefined))
  })

  test("rejects external explicit paths by default", () => {
    expect(() => assertTrustedDbPath("/tmp/trade-memory.sqlite3", "index_db_path")).toThrow("index_db_path must be inside")
  })

  test("allows relative source paths after canonical resolution", () => {
    expect(resolveSourceDbPath("opencode-beta.db")).toContain("opencode-beta.db")
    expect(() => assertTrustedDbPath("opencode-beta.db", "source_db_path")).not.toThrow()
  })

  test("allows external explicit paths when explicitly enabled", () => {
    const previous = process.env.OPENCODE_TRADE_ALLOW_EXTERNAL_DB_PATHS
    process.env.OPENCODE_TRADE_ALLOW_EXTERNAL_DB_PATHS = "true"
    try {
      expect(resolveIndexDbPath("  /tmp/trade-memory.sqlite3  ")).toBe("/tmp/trade-memory.sqlite3")
      expect(() => assertTrustedDbPath("/tmp/trade-memory.sqlite3", "index_db_path")).not.toThrow()
    } finally {
      process.env.OPENCODE_TRADE_ALLOW_EXTERNAL_DB_PATHS = previous
    }
  })
})
