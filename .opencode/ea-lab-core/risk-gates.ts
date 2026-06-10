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
