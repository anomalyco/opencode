import { afterAll, beforeAll, describe, expect, test } from "bun:test"

let Database: typeof import("../../src/storage/db").Database

const prev = process.env["OPENCODE_DISABLE_CHANNEL_DB"]

beforeAll(async () => {
  process.env["OPENCODE_DISABLE_CHANNEL_DB"] = "0"
  ;({ Database } = await import(`../../src/storage/db?test=${Date.now()}`))
})

afterAll(() => {
  if (prev === undefined) {
    delete process.env["OPENCODE_DISABLE_CHANNEL_DB"]
    return
  }
  process.env["OPENCODE_DISABLE_CHANNEL_DB"] = prev
})

describe("Database.file", () => {
  test("uses the shared database for latest", () => {
    expect(Database.file("latest")).toBe("opencode.db")
  })

  test("sanitizes preview channels for filenames", () => {
    expect(Database.file("fix/windows-modified-files-tracking")).toBe("opencode-fix-windows-modified-files-tracking.db")
  })
})
