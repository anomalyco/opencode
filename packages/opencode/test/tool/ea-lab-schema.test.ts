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

  test("creates all phase 1 tables and fts tables", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const names = db
        .query<{ name: string }, []>("select name from sqlite_master where type in ('table', 'virtual table') order by name")
        .all()
        .map((row) => row.name)
      expect(names).toContain("raw_event")
      expect(names).toContain("evidence")
      expect(names).toContain("experiment")
      expect(names).toContain("experience")
      expect(names).toContain("experience_evidence")
      expect(names).toContain("risk_gate_check")
      expect(names).toContain("promotion_decision")
      expect(names).toContain("handoff_log")
      expect(names).toContain("experience_fts")
      expect(names).toContain("evidence_fts")
    } finally {
      db.close(false)
    }
  })
})
