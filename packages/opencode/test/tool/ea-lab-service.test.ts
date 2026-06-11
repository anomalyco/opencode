import { describe, expect, test } from "bun:test"
import path from "path"
import { createEaLabService } from "../../../../.opencode/mcp/ea-lab-service"
import { tmpdir } from "../fixture/fixture"

describe("ea-lab service", () => {
  test("reports health and stores searchable experience", async () => {
    await using tmp = await tmpdir()
    const service = createEaLabService({
      dbPath: path.join(tmp.path, "ea-lab.sqlite3"),
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })
    expect((await service.health()).ok).toBe(true)
    const stored = await service.storeExperience({
      type: "failure",
      situation: "XAUUSD breakout high PF low trade count",
      trigger_conditions_json: JSON.stringify({ symbol: "XAUUSD", strategy: "breakout_pullback", timeframe: "M15" }),
      action_taken: "considered promotion",
      outcome: "failed OOS",
      lesson: "PF alone is not enough",
      reuse_rule: "require OOS and spread sensitivity",
      anti_rule: "do not reject every breakout setup",
      confidence: "medium",
      status: "active",
    })
    const result = await service.searchSimilarExperiences({
      query: "XAUUSD breakout low trade count",
      symbol: "XAUUSD",
      strategy: "breakout_pullback",
      timeframe: "M15",
    })
    expect(result.rows[0]?.id).toBe(stored.id)
  })

  test("serves health over http", async () => {
    await using tmp = await tmpdir()
    const service = createEaLabService({
      dbPath: path.join(tmp.path, "ea-lab.sqlite3"),
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })
    const { startEaLabHttpServer } = await import("../../../../.opencode/mcp/ea-lab-http")
    const server = startEaLabHttpServer({ service, port: 0 })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(response.ok).toBe(true)
      expect(await response.json()).toMatchObject({ ok: true })
    } finally {
      void server.stop(true)
    }
  })
})
