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

  test("redacts secret-like evidence text before indexing", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const stored = storeEvidence(db, {
        evidence_type: "manual_note",
        uri: "https://example.test/report?token=secret-token-1234567890&symbol=XAUUSD",
        file_path: "/tmp/report.html?api_key=file-api-key-1234567890",
        checksum: "sha256:abc?refresh_token=checksum-refresh-1234567890",
        description: "https://report.test/view?access_token=desc-access-1234567890 Authorization: Bearer abcdef1234567890",
      })
      expect(stored.uri).toContain("token=[REDACTED_SECRET]")
      expect(stored.uri).toContain("symbol=XAUUSD")
      expect(stored.uri).not.toContain("secret-token-1234567890")
      expect(stored.file_path).toContain("api_key=[REDACTED_SECRET]")
      expect(stored.file_path).not.toContain("file-api-key-1234567890")
      expect(stored.checksum).toContain("refresh_token=[REDACTED_SECRET]")
      expect(stored.checksum).not.toContain("checksum-refresh-1234567890")
      expect(stored.description).toContain("[REDACTED_TOKEN]")
      expect(stored.description).not.toContain("abcdef1234567890")
      expect(searchEvidence(db, "REDACTED_TOKEN", 5).rows[0]?.id).toBe(stored.id)
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
