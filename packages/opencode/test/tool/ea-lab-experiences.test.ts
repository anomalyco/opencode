import { describe, expect, test } from "bun:test"
import path from "path"
import { openEaLabDatabase } from "../../../../.opencode/ea-lab-core/db"
import { storeEvidence } from "../../../../.opencode/ea-lab-core/evidence"
import { attachExperienceEvidence, searchSimilarExperiences, storeExperience } from "../../../../.opencode/ea-lab-core/experiences"
import { ensureEaLabSchema } from "../../../../.opencode/ea-lab-core/schema"
import { tmpdir } from "../fixture/fixture"

describe("ea-lab experiences", () => {
  test("stores active failure memory and retrieves similar records", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const experience = storeExperience(db, {
        type: "failure",
        situation: "XAUUSD breakout produced high PF with low trade count",
        trigger_conditions_json: JSON.stringify({ symbol: "XAUUSD", strategy: "breakout_pullback", timeframe: "M15" }),
        action_taken: "considered promotion after parameter optimization",
        outcome: "out-of-sample performance collapsed",
        lesson: "PF alone is not enough",
        reuse_rule: "require OOS, monthly stability, spread sensitivity, and minimum trade count",
        anti_rule: "do not reject all breakout systems based on this case",
        confidence: "high",
        status: "active",
      })
      const evidence = storeEvidence(db, {
        evidence_type: "backtest_report",
        file_path: "reports/backtests/xauusd-001.html",
        description: "OOS collapse report",
      })
      attachExperienceEvidence(db, experience.id, evidence.id)

      const result = searchSimilarExperiences(db, {
        query: "XAUUSD breakout low trade count",
        symbol: "XAUUSD",
        strategy: "breakout_pullback",
        timeframe: "M15",
        limit: 3,
      })
      expect(result.rows[0]?.id).toBe(experience.id)
      expect(result.rows[0]?.evidence_ids).toEqual([evidence.id])
    } finally {
      db.close(false)
    }
  })

  test("rejects active success memory without anti-rule", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      expect(() =>
        storeExperience(db, {
          type: "success",
          situation: "profitable short test",
          trigger_conditions_json: "{}",
          action_taken: "optimized parameters",
          outcome: "profit",
          lesson: "seemed good",
          reuse_rule: "reuse when similar",
          anti_rule: "",
          confidence: "medium",
          status: "active",
        }),
      ).toThrow("anti_rule must not be empty")
    } finally {
      db.close(false)
    }
  })

  test("returns no similar experiences for unsearchable query", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const result = searchSimilarExperiences(db, { query: "x", limit: 3 })
      expect(result.rows).toEqual([])
    } finally {
      db.close(false)
    }
  })

  test("redacts secret-like experience text before indexing", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const stored = storeExperience(db, {
        type: "risk",
        situation: "Authorization: Bearer abcdef1234567890 leaked during review",
        trigger_conditions_json: JSON.stringify({ note: "OPENAI_API_KEY=sk-test-secret" }),
        action_taken: "removed the secret",
        outcome: "safe storage restored",
        lesson: "never persist raw tokens",
        reuse_rule: "redact before storing",
        anti_rule: "do not keep raw secrets in notes",
        confidence: "high",
        status: "active",
      })
      expect(stored.situation).toContain("[REDACTED_TOKEN]")
      expect(searchSimilarExperiences(db, { query: "REDACTED_TOKEN", limit: 3 }).rows[0]?.id).toBe(stored.id)
    } finally {
      db.close(false)
    }
  })
})
