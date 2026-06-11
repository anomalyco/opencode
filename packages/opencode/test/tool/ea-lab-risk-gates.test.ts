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
})
