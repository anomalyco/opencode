import { describe, test, expect, afterEach } from "bun:test"
import { detectDialect } from "../dialect-detect"

describe("dialect detection", () => {
  const originalEnv = process.env.OPENCODE_DATABASE_URL

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCODE_DATABASE_URL
    } else {
      process.env.OPENCODE_DATABASE_URL = originalEnv
    }
  })

  test("defaults to sqlite when no OPENCODE_DATABASE_URL", () => {
    delete process.env.OPENCODE_DATABASE_URL
    expect(detectDialect()).toBe("sqlite")
  })

  test("detects postgres from postgres:// URL", () => {
    process.env.OPENCODE_DATABASE_URL = "postgres://user:pass@localhost:5432/db"
    expect(detectDialect()).toBe("postgres")
  })

  test("detects postgres from postgresql:// URL", () => {
    process.env.OPENCODE_DATABASE_URL = "postgresql://user:pass@localhost:5432/db"
    expect(detectDialect()).toBe("postgres")
  })

  test("falls back to sqlite for unknown URL schemes", () => {
    process.env.OPENCODE_DATABASE_URL = "mysql://user:pass@localhost/db"
    expect(detectDialect()).toBe("sqlite")
  })

  test("falls back to sqlite for empty string", () => {
    process.env.OPENCODE_DATABASE_URL = ""
    expect(detectDialect()).toBe("sqlite")
  })
})
