import { describe, expect, test } from "bun:test"
import path from "path"
import { checkRiskGates, parseRiskGates } from "../../../../.opencode/ea-lab-core/risk-gates"

describe("ea-lab risk gates", () => {
  test("parses conservative gates", async () => {
    const gates = await parseRiskGates(path.resolve("../../risk/gates.yaml"))
    expect(gates.live_trading.ai_can_enable).toBe(false)
    expect(gates.live_trading.requires_human_approval).toBe(true)
    expect(gates.hard_blocks).toContain("martingale")
  })

  test("blocks unsafe promotion candidates", async () => {
    const gates = await parseRiskGates(path.resolve("../../risk/gates.yaml"))
    const result = checkRiskGates(gates, {
      targetType: "promotion",
      targetID: "exp_1",
      stage: "backtest",
      requestedAction: "promote",
      metrics: { trade_count: 12, max_drawdown_percent: 12 },
      hasOutOfSample: false,
      hasSpreadSensitivity: false,
    })
    expect(result.passed).toBe(false)
    expect(result.violations.map((item) => item.name)).toContain("minimum_trade_count")
    expect(result.violations.map((item) => item.name)).toContain("promote_without_out_of_sample_test")
  })

  test("blocks live trading, martingale, unsafe grid, lot increase, and single-period optimization", async () => {
    const gates = await parseRiskGates(path.resolve("../../risk/gates.yaml"))
    const result = checkRiskGates(gates, {
      targetType: "promotion",
      targetID: "exp_2",
      stage: "demo_forward",
      requestedAction: "promote",
      metrics: { trade_count: 40, max_drawdown_percent: 5 },
      hasOutOfSample: true,
      hasSpreadSensitivity: true,
      hasDemoForward: false,
      wantsLiveTrading: true,
      wantsLotIncrease: true,
      wantsGateRelaxation: true,
      usesMartingale: true,
      usesGrid: true,
      hasHardMaxLoss: false,
      optimizedOnSinglePeriod: true,
    })
    expect(result.passed).toBe(false)
    expect(result.violations.map((item) => item.name)).toContain("martingale")
    expect(result.violations.map((item) => item.name)).toContain("grid_without_max_loss")
    expect(result.violations.map((item) => item.name)).toContain("increase_lot_after_loss")
    expect(result.violations.map((item) => item.name)).toContain("live_trading_ai_can_enable")
    expect(result.violations.map((item) => item.name)).toContain("live_trading_requires_human_approval")
    expect(result.violations.map((item) => item.name)).toContain("live_deploy_without_demo_forward")
    expect(result.violations.map((item) => item.name)).toContain("optimize_on_single_period_only")
    expect(result.violations.map((item) => item.name)).toContain("risk_gate_relaxation_requires_human_review")
  })
})
