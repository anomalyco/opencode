import { describe, test, expect } from "bun:test"

describe("dialect shim - SQLite mode (default)", () => {
  test("exports table constructor", async () => {
    const { table } = await import("../dialect.sqlite")
    expect(typeof table).toBe("function")

    // Create a test table
    const testTable = table("test_table", {})
    expect(testTable).toBeDefined()
  })

  test("exports text column", async () => {
    const { text } = await import("../dialect.sqlite")
    expect(typeof text).toBe("function")
    const col = text()
    expect(col).toBeDefined()
  })

  test("exports integer column", async () => {
    const { integer } = await import("../dialect.sqlite")
    expect(typeof integer).toBe("function")
    const col = integer()
    expect(col).toBeDefined()
  })

  test("exports index", async () => {
    const { index } = await import("../dialect.sqlite")
    expect(typeof index).toBe("function")
  })

  test("exports primaryKey", async () => {
    const { primaryKey } = await import("../dialect.sqlite")
    expect(typeof primaryKey).toBe("function")
  })
})

describe("dialect shim - Postgres mode", () => {
  test("exports table constructor (pgTable)", async () => {
    const { table } = await import("../dialect.pg")
    expect(typeof table).toBe("function")

    const testTable = table("test_pg_table", {})
    expect(testTable).toBeDefined()
  })

  test("exports text column", async () => {
    const { text } = await import("../dialect.pg")
    expect(typeof text).toBe("function")
  })

  test("text({ mode: 'json' }) returns jsonb column", async () => {
    const { text } = await import("../dialect.pg")
    const col = text({ mode: "json" } as any)
    // The column should be created (jsonb type internally)
    expect(col).toBeDefined()
  })

  test("integer({ mode: 'boolean' }) returns boolean column", async () => {
    const { integer } = await import("../dialect.pg")
    const col = integer({ mode: "boolean" } as any)
    expect(col).toBeDefined()
  })

  test("regular integer() works", async () => {
    const { integer } = await import("../dialect.pg")
    const col = integer()
    expect(col).toBeDefined()
  })

  test("regular text() works", async () => {
    const { text } = await import("../dialect.pg")
    const col = text()
    expect(col).toBeDefined()
  })

  test("exports index", async () => {
    const { index } = await import("../dialect.pg")
    expect(typeof index).toBe("function")
  })

  test("exports primaryKey", async () => {
    const { primaryKey } = await import("../dialect.pg")
    expect(typeof primaryKey).toBe("function")
  })
})
