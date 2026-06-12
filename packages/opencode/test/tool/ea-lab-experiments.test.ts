import { describe, expect, test } from "bun:test"
import path from "path"
import { openEaLabDatabase } from "../../../../.opencode/ea-lab-core/db"
import { storeExperiment, updateExperimentResult } from "../../../../.opencode/ea-lab-core/experiments"
import { ensureEaLabSchema } from "../../../../.opencode/ea-lab-core/schema"
import { tmpdir } from "../fixture/fixture"

describe("ea-lab experiments", () => {
  test("stores and updates an experiment", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const experiment = storeExperiment(db, {
        title: "XAUUSD breakout pullback baseline",
        symbol: "XAUUSD",
        timeframe: "M15",
        strategy: "breakout_pullback",
        hypothesis: "Pullback confirmation may reduce false breakouts",
        implementation_summary: "No code yet",
        test_conditions_json: JSON.stringify({ period: "2024-01-01/2024-12-31", spread: 30 }),
        metrics_json: JSON.stringify({}),
        result_status: "draft",
        stage: "research",
        overfit_risk: "unknown",
      })
      const updated = updateExperimentResult(db, experiment.id, {
        metrics_json: JSON.stringify({ trade_count: 12, profit_factor: 2.4 }),
        result_status: "failed",
        overfit_risk: "high",
      })
      expect(updated.result_status).toBe("failed")
      expect(updated.overfit_risk).toBe("high")
    } finally {
      db.close(false)
    }
  })

  test("redacts secret-like experiment text before storing", async () => {
    await using tmp = await tmpdir()
    const db = openEaLabDatabase(path.join(tmp.path, "ea-lab.sqlite3"), true)

    try {
      ensureEaLabSchema(db)
      const experiment = storeExperiment(db, {
        title: "Bearer abcdef1234567890 baseline",
        symbol: "XAUUSD",
        timeframe: "M15",
        strategy: "breakout_pullback",
        hypothesis: "OPENAI_API_KEY=sk-test-secret should never persist",
        implementation_summary: "password: hunter2",
        test_conditions_json: JSON.stringify({ token: "raw-token-1234567890", nested: { note: "https://data.test/feed?access_token=json-access-1234567890" } }),
        metrics_json: JSON.stringify({ api_key: "raw-api-key-1234567890", report: "https://report.test/view?password=json-password-1234567890" }),
        result_status: "draft",
        stage: "research",
        overfit_risk: "unknown",
      })
      expect(experiment.title).toContain("[REDACTED_TOKEN]")
      expect(experiment.hypothesis).toContain("[REDACTED_SECRET]")
      expect(experiment.implementation_summary).toContain("[REDACTED_SECRET]")
      expect(experiment.test_conditions_json).toContain('"token":"[REDACTED_SECRET]"')
      expect(experiment.test_conditions_json).toContain("access_token=[REDACTED_SECRET]")
      expect(experiment.metrics_json).toContain('"api_key":"[REDACTED_SECRET]"')
      expect(experiment.metrics_json).toContain("password=[REDACTED_SECRET]")

      const updated = updateExperimentResult(db, experiment.id, {
        metrics_json: JSON.stringify({ nested: { refresh_token: "updated-refresh-1234567890" }, link: "https://update.test/view?token=updated-token-1234567890" }),
        result_status: "running",
        overfit_risk: "low",
      })
      expect(updated.metrics_json).toContain('"refresh_token":"[REDACTED_SECRET]"')
      expect(updated.metrics_json).toContain("token=[REDACTED_SECRET]")
    } finally {
      db.close(false)
    }
  })
})
