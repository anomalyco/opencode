import { describe, expect, test } from "bun:test"
import path from "path"
import { openEaLabDatabase } from "../../../../.opencode/ea-lab-core/db"
import { storeEvidence, searchEvidence } from "../../../../.opencode/ea-lab-core/evidence"
import { ensureEaLabSchema } from "../../../../.opencode/ea-lab-core/schema"
import { tmpdir } from "../fixture/fixture"

describe("ea-lab evidence", () => {
  test("stores evidence with at least one locator", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const stored = storeEvidence(db, {
        evidence_type: "backtest_report",
        file_path: "reports/backtests/xauusd-001.html",
        description: "XAUUSD breakout backtest report",
      })
      expect(stored.id).toBeTruthy()
      expect(searchEvidence(db, "breakout", 5).rows[0]?.id).toBe(stored.id)
    } finally {
      db.close(false)
    }
  })

  test("rejects evidence without locator", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      expect(() => storeEvidence(db, { evidence_type: "manual_note", description: "no locator" })).toThrow(
        "evidence requires at least one locator",
      )
    } finally {
      db.close(false)
    }
  })
})
