import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"

describe("Database.file", () => {
  test("uses the shared database for latest", () => {
    expect(Database.file("latest")).toBe("opencode.db")
  })

  test("sanitizes preview channels for filenames", () => {
    expect(Database.file("fix/windows-modified-files-tracking")).toBe("opencode-fix-windows-modified-files-tracking.db")
  })
})
