import { describe, expect, test } from "bun:test"
import path from "path"
import { openEaLabDatabase, resolveEaLabDbPath } from "../../../../.opencode/ea-lab-core/db"
import { ensureEaLabSchema, readEaLabMeta } from "../../../../.opencode/ea-lab-core/schema"
import { tmpdir } from "../fixture/fixture"

describe("ea-lab schema", () => {
  test("resolves explicit and default database paths", () => {
    expect(resolveEaLabDbPath("  /tmp/ea-lab.sqlite3  ")).toBe("/tmp/ea-lab.sqlite3")
    expect(resolveEaLabDbPath()).toContain("ea-lab.sqlite3")
  })

  test("creates schema metadata", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      expect(readEaLabMeta(db, "ea_lab_schema_version")).toBe("1")
    } finally {
      db.close(false)
    }
  })
})
