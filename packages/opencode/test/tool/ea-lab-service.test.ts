import { afterEach, describe, expect, test } from "bun:test"
import { openEaLabDatabase } from "../../../../.opencode/ea-lab-core/db"
import path from "path"
import { createEaLabService } from "../../../../.opencode/mcp/ea-lab-service"
import { ensureEaLabSchema } from "../../../../.opencode/ea-lab-core/schema"
import { tmpdir } from "../fixture/fixture"
import { startTestHttpServer } from "../lib/http-server"

const baseEnv = {
  allowUnauth: process.env.OPENCODE_EA_LAB_ALLOW_UNAUTH_LOCALHOST,
  token: process.env.OPENCODE_EA_LAB_SERVICE_TOKEN,
}

afterEach(() => {
  process.env.OPENCODE_EA_LAB_ALLOW_UNAUTH_LOCALHOST = baseEnv.allowUnauth
  process.env.OPENCODE_EA_LAB_SERVICE_TOKEN = baseEnv.token
})

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
    process.env.OPENCODE_EA_LAB_ALLOW_UNAUTH_LOCALHOST = "true"
    const service = createEaLabService({
      dbPath: path.join(tmp.path, "ea-lab.sqlite3"),
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })
    const { startEaLabHttpServer } = await import("../../../../.opencode/mcp/ea-lab-http")
    const server = startTestHttpServer((port) => startEaLabHttpServer({ service, hostname: "127.0.0.1", port }))

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(response.ok).toBe(true)
      expect(await response.json()).toMatchObject({ ok: true })
    } finally {
      void server.stop(true)
    }
  })

  test("rejects unauthorized http health requests when token is configured", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_EA_LAB_SERVICE_TOKEN = "test-token"
    const service = createEaLabService({
      dbPath: path.join(tmp.path, "ea-lab.sqlite3"),
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })
    const { startEaLabHttpServer } = await import("../../../../.opencode/mcp/ea-lab-http")
    const server = startTestHttpServer((port) => startEaLabHttpServer({ service, hostname: "127.0.0.1", port }))

    try {
      const denied = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(denied.status).toBe(401)
      const allowed = await fetch(`http://127.0.0.1:${server.port}/health`, {
        headers: { authorization: "Bearer test-token" },
      })
      expect(allowed.ok).toBe(true)
    } finally {
      void server.stop(true)
    }
  })

  test("blocks storing promoted experiments when risk gates fail", async () => {
    await using tmp = await tmpdir()
    const dbPath = path.join(tmp.path, "ea-lab.sqlite3")
    const service = createEaLabService({
      dbPath,
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })

    await expect(
      service.storeExperiment({
        title: "unsafe promotion",
        symbol: "XAUUSD",
        timeframe: "M15",
        strategy: "breakout_pullback",
        hypothesis: "should be blocked",
        metrics: { trade_count: 12, max_drawdown_percent: 12 },
        result_status: "promoted",
        stage: "backtest",
      }),
    ).rejects.toThrow("minimum_trade_count")

    expect(readExperimentCount(dbPath)).toBe(0)
  })

  test("blocks storing live stage experiments by inferred live intent", async () => {
    await using tmp = await tmpdir()
    const dbPath = path.join(tmp.path, "ea-lab.sqlite3")
    const service = createEaLabService({
      dbPath,
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })

    await expect(
      service.storeExperiment({
        title: "unsafe live",
        symbol: "XAUUSD",
        timeframe: "M15",
        strategy: "breakout_pullback",
        hypothesis: "should be blocked",
        metrics: { trade_count: 40, max_drawdown_percent: 5 },
        result_status: "passed",
        stage: "micro_live",
        hasOutOfSample: true,
        hasSpreadSensitivity: true,
      }),
    ).rejects.toThrow("live_trading_ai_can_enable")

    await expect(
      service.storeExperiment({
        title: "unsafe limited live",
        symbol: "XAUUSD",
        timeframe: "M15",
        strategy: "breakout_pullback",
        hypothesis: "should be blocked",
        metrics: { trade_count: 40, max_drawdown_percent: 5 },
        result_status: "passed",
        stage: "limited_live",
        hasOutOfSample: true,
        hasSpreadSensitivity: true,
        hasDemoForward: true,
      }),
    ).rejects.toThrow("live_trading_ai_can_enable")

    expect(readExperimentCount(dbPath)).toBe(0)
  })

  test("blocks promoted experiment updates and leaves existing row unchanged", async () => {
    await using tmp = await tmpdir()
    const dbPath = path.join(tmp.path, "ea-lab.sqlite3")
    const service = createEaLabService({
      dbPath,
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })
    const experiment = await service.storeExperiment({
      title: "draft baseline",
      symbol: "XAUUSD",
      timeframe: "M15",
      strategy: "breakout_pullback",
      hypothesis: "baseline",
    })

    await expect(
      service.updateExperimentResult({
        id: experiment.id,
        metrics: { trade_count: 12, max_drawdown_percent: 12 },
        result_status: "promoted",
      }),
    ).rejects.toThrow("minimum_trade_count")

    expect(readExperimentRow(dbPath, experiment.id)).toMatchObject({
      result_status: "draft",
      stage: "research",
      metrics_json: "{}",
    })
  })

  test("blocks live stage updates and leaves existing row unchanged", async () => {
    await using tmp = await tmpdir()
    const dbPath = path.join(tmp.path, "ea-lab.sqlite3")
    const service = createEaLabService({
      dbPath,
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })
    const experiment = await service.storeExperiment({
      title: "demo candidate",
      symbol: "XAUUSD",
      timeframe: "M15",
      strategy: "breakout_pullback",
      hypothesis: "baseline",
      metrics: { trade_count: 40, max_drawdown_percent: 5 },
      result_status: "passed",
      stage: "demo_forward",
    })

    await expect(
      service.updateExperimentResult({
        id: experiment.id,
        stage: "micro_live",
        result_status: "passed",
        metrics: { trade_count: 40, max_drawdown_percent: 5 },
        hasOutOfSample: true,
        hasSpreadSensitivity: true,
        hasDemoForward: true,
      }),
    ).rejects.toThrow("live_trading_ai_can_enable")

    expect(readExperimentRow(dbPath, experiment.id)).toMatchObject({
      result_status: "passed",
      stage: "demo_forward",
    })
  })

  test("allows non-promotional failure updates", async () => {
    await using tmp = await tmpdir()
    const dbPath = path.join(tmp.path, "ea-lab.sqlite3")
    const service = createEaLabService({
      dbPath,
      riskGatePath: path.resolve("../../risk/gates.yaml"),
    })
    const experiment = await service.storeExperiment({
      title: "candidate",
      symbol: "XAUUSD",
      timeframe: "M15",
      strategy: "breakout_pullback",
      hypothesis: "baseline",
    })
    const updated = await service.updateExperimentResult({
      id: experiment.id,
      metrics: { trade_count: 5 },
      result_status: "failed",
      overfit_risk: "high",
    })

    expect(updated.result_status).toBe("failed")
    expect(updated.overfit_risk).toBe("high")
  })
})

function readExperimentCount(dbPath: string) {
  const db = openEaLabDatabase(dbPath, true)
  try {
    ensureEaLabSchema(db)
    return db.query<{ count: number }, []>("select count(*) as count from experiment").get()!.count
  } finally {
    db.close(false)
  }
}

function readExperimentRow(dbPath: string, id: string) {
  const db = openEaLabDatabase(dbPath, true)
  try {
    ensureEaLabSchema(db)
    return db.query<{ result_status: string; stage: string; metrics_json: string }, [string]>(
      "select result_status, stage, metrics_json from experiment where id = ? limit 1",
    ).get(id)
  } finally {
    db.close(false)
  }
}
