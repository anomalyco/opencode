export type RiskGates = {
  live_trading: {
    ai_can_enable: boolean
    requires_human_approval: boolean
  }
  limits: {
    max_lot: number
    max_daily_loss_usd: number
    max_weekly_loss_usd: number
    max_consecutive_losses: number
    max_drawdown_percent: number
    minimum_trade_count: number
  }
  hard_blocks: string[]
}

export type RiskGateCheckInput = {
  targetType: string
  targetID: string
  stage: string
  requestedAction: string
  metrics: {
    trade_count?: number
    max_drawdown_percent?: number
  }
  hasOutOfSample: boolean
  hasSpreadSensitivity: boolean
  hasDemoForward?: boolean
  wantsLiveTrading?: boolean
  wantsLotIncrease?: boolean
  wantsGateRelaxation?: boolean
  usesMartingale?: boolean
  usesGrid?: boolean
  hasHardMaxLoss?: boolean
  optimizedOnSinglePeriod?: boolean
}

export type RiskGateViolation = {
  name: string
  severity: "hard"
  reason: string
}

export async function parseRiskGates(filePath: string): Promise<RiskGates> {
  const text = await Bun.file(filePath).text()
  return requireRiskGates(parseSimpleYaml(text))
}

export function checkRiskGates(gates: RiskGates, input: RiskGateCheckInput) {
  const violations = [
    input.metrics.trade_count !== undefined && input.metrics.trade_count < gates.limits.minimum_trade_count
      ? {
          name: "minimum_trade_count",
          severity: "hard" as const,
          reason: `trade_count ${input.metrics.trade_count} is below minimum ${gates.limits.minimum_trade_count}`,
        }
      : undefined,
    input.metrics.max_drawdown_percent !== undefined && input.metrics.max_drawdown_percent > gates.limits.max_drawdown_percent
      ? {
          name: "max_drawdown_percent",
          severity: "hard" as const,
          reason: `max_drawdown_percent ${input.metrics.max_drawdown_percent} exceeds limit ${gates.limits.max_drawdown_percent}`,
        }
      : undefined,
    input.requestedAction === "promote" && !input.hasOutOfSample && gates.hard_blocks.includes("promote_without_out_of_sample_test")
      ? {
          name: "promote_without_out_of_sample_test",
          severity: "hard" as const,
          reason: "promotion requires out-of-sample test evidence",
        }
      : undefined,
    input.requestedAction === "promote" && !input.hasSpreadSensitivity && gates.hard_blocks.includes("promote_without_spread_sensitivity_test")
      ? {
          name: "promote_without_spread_sensitivity_test",
          severity: "hard" as const,
          reason: "promotion requires spread sensitivity evidence",
        }
      : undefined,
    input.wantsLiveTrading && !gates.live_trading.ai_can_enable
      ? {
          name: "live_trading_ai_can_enable",
          severity: "hard" as const,
          reason: "AI cannot enable live trading",
        }
      : undefined,
    input.wantsLiveTrading && gates.live_trading.requires_human_approval
      ? {
          name: "live_trading_requires_human_approval",
          severity: "hard" as const,
          reason: "live trading requires human approval",
        }
      : undefined,
    input.usesMartingale && gates.hard_blocks.includes("martingale")
      ? {
          name: "martingale",
          severity: "hard" as const,
          reason: "martingale is hard blocked",
        }
      : undefined,
    input.usesGrid && !input.hasHardMaxLoss && gates.hard_blocks.includes("grid_without_max_loss")
      ? {
          name: "grid_without_max_loss",
          severity: "hard" as const,
          reason: "grid strategies require a hard max loss",
        }
      : undefined,
    input.wantsLotIncrease && gates.hard_blocks.includes("increase_lot_after_loss")
      ? {
          name: "increase_lot_after_loss",
          severity: "hard" as const,
          reason: "lot increases after loss are hard blocked",
        }
      : undefined,
    input.wantsLiveTrading && !input.hasDemoForward && gates.hard_blocks.includes("live_deploy_without_demo_forward")
      ? {
          name: "live_deploy_without_demo_forward",
          severity: "hard" as const,
          reason: "live deployment requires demo forward evidence",
        }
      : undefined,
    input.optimizedOnSinglePeriod && gates.hard_blocks.includes("optimize_on_single_period_only")
      ? {
          name: "optimize_on_single_period_only",
          severity: "hard" as const,
          reason: "single-period-only optimization is hard blocked",
        }
      : undefined,
    input.wantsGateRelaxation
      ? {
          name: "risk_gate_relaxation_requires_human_review",
          severity: "hard" as const,
          reason: "risk gate relaxation requires explicit human review",
        }
      : undefined,
  ].filter((item): item is RiskGateViolation => item !== undefined)
  return { passed: violations.length === 0, violations }
}

function parseSimpleYaml(text: string) {
  const root: Record<string, unknown> = {}
  let section = ""

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "")
    if (!line.trim() || line.trim().startsWith("#")) continue
    if (!line.startsWith(" ") && line.endsWith(":")) {
      section = line.slice(0, -1)
      root[section] = section === "hard_blocks" ? [] : {}
      continue
    }
    if (section === "hard_blocks" && line.trim().startsWith("- ")) {
      ;(root.hard_blocks as string[]).push(line.trim().slice(2))
      continue
    }
    const match = line.trim().match(/^([^:]+):\s*(.+)$/)
    if (!match || !section) continue
    ;(root[section] as Record<string, unknown>)[match[1]] = parseYamlScalar(match[2])
  }

  return root
}

function parseYamlScalar(input: string) {
  if (input === "true") return true
  if (input === "false") return false
  const number = Number(input)
  return Number.isFinite(number) ? number : input
}

function requireRiskGates(input: Record<string, unknown>): RiskGates {
  const liveTrading = input.live_trading as RiskGates["live_trading"] | undefined
  const limits = input.limits as RiskGates["limits"] | undefined
  const hardBlocks = input.hard_blocks as string[] | undefined
  if (!liveTrading || !limits || !Array.isArray(hardBlocks)) throw new Error("invalid risk gates")
  return { live_trading: liveTrading, limits, hard_blocks: hardBlocks }
}
