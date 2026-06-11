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
})
