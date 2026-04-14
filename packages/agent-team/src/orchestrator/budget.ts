import type { AgentID } from "../protocol/messages.js"

type TokenUsage = { input: number; output: number; total: number }

type BudgetConfig = {
  daily_limit_usd: number
  per_agent_daily_usd: number
  per_task_max_usd: number
  per_task_max_tokens: number
}

type AgentUsage = {
  tokens: TokenUsage
  cost: number
  date: string
}

export class BudgetManager {
  private config: BudgetConfig
  private usage = new Map<AgentID, AgentUsage>()
  private teamUsage: AgentUsage

  constructor(config?: Partial<BudgetConfig>) {
    this.config = {
      daily_limit_usd: config?.daily_limit_usd ?? 50,
      per_agent_daily_usd: config?.per_agent_daily_usd ?? 15,
      per_task_max_usd: config?.per_task_max_usd ?? 5,
      per_task_max_tokens: config?.per_task_max_tokens ?? 200000,
    }
    this.teamUsage = this.emptyUsage()
  }

  trackUsage(agentId: AgentID, tokens: number, cost: number): void {
    const today = this.today()
    const current = this.usage.get(agentId)
    if (current && current.date === today) {
      current.tokens.input += tokens
      current.tokens.total += tokens
      current.cost += cost
    } else {
      this.usage.set(agentId, {
        tokens: { input: tokens, output: 0, total: tokens },
        cost,
        date: today,
      })
    }
    if (this.teamUsage.date === today) {
      this.teamUsage.tokens.input += tokens
      this.teamUsage.tokens.total += tokens
      this.teamUsage.cost += cost
    } else {
      this.teamUsage = {
        tokens: { input: tokens, output: 0, total: tokens },
        cost,
        date: today,
      }
    }
  }

  getUsage(agentId: AgentID): TokenUsage & { cost: number } {
    const u = this.usage.get(agentId)
    if (!u || u.date !== this.today()) return { input: 0, output: 0, total: 0, cost: 0 }
    return { ...u.tokens, cost: u.cost }
  }

  getTeamUsage(): TokenUsage & { cost: number } {
    if (this.teamUsage.date !== this.today()) return { input: 0, output: 0, total: 0, cost: 0 }
    return { ...this.teamUsage.tokens, cost: this.teamUsage.cost }
  }

  checkBudget(agentId: AgentID | "team", estimatedCost: number): boolean {
    const today = this.today()
    if (agentId === "team") {
      const teamUsed = this.teamUsage.date === today ? this.teamUsage.cost : 0
      if (teamUsed + estimatedCost > this.config.daily_limit_usd) return false
    } else {
      const agentUsed = this.getUsage(agentId)
      if (agentUsed.cost + estimatedCost > this.config.per_agent_daily_usd) return false
    }
    if (estimatedCost > this.config.per_task_max_usd) return false
    return true
  }

  checkTokenBudget(tokens: number): boolean {
    return tokens <= this.config.per_task_max_tokens
  }

  resetDaily(): void {
    this.usage.clear()
    this.teamUsage = this.emptyUsage()
  }

  getBudget(): BudgetConfig & { team_remaining_usd: number } {
    const teamUsed = this.teamUsage.date === this.today() ? this.teamUsage.cost : 0
    return {
      ...this.config,
      team_remaining_usd: this.config.daily_limit_usd - teamUsed,
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private emptyUsage(): AgentUsage {
    return { tokens: { input: 0, output: 0, total: 0 }, cost: 0, date: this.today() }
  }
}
