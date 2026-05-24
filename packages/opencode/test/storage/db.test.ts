import { describe, expect, it } from "bun:test"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { Database } from "@/storage/db"

describe("Database.getPath", () => {
  it("delegates to the core database path", () => {
    expect(Database.getPath()).toBe(CoreDatabase.path())
  })
})
