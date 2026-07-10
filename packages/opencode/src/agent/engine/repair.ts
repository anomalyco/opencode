import { createHash } from "crypto"

export type ErrorCategory = "not_found" | "permission" | "timeout" | "syntax" | "resource" | "network" | "unknown"

export interface RecoveryRule {
  repair_id: string
  tool: string
  category: ErrorCategory
  condition: string
  recovery_action: string
  specificity: number
  hit_count: number
  last_hit: number
  occurrence_count: number
  success_rate: number
  created_at: number
}

export class ErrorClassifier {
  classify(error: string): ErrorCategory {
    const e = error.toLowerCase()
    const patterns: [ErrorCategory, string[]][] = [
      ["not_found", ["not found", "no such file", "does not exist", "path not found", "enoent"]],
      ["permission", ["permission", "denied", "forbidden", "unauthorized", "eacces"]],
      ["timeout", ["timeout", "timed out", "deadline exceeded", "etimedout"]],
      ["syntax", ["syntax", "invalid syntax", "parse error", "unexpected token", "esyntax"]],
      ["resource", ["oom", "out of memory", "disk full", "enospc"]],
      ["network", ["network", "connection refused", "econnrefused", "enotfound"]],
    ]
    for (const [category, keywords] of patterns) {
      if (keywords.some((k) => e.includes(k))) return category
    }
    return "unknown"
  }

  extractStructure(error: string): {
    error_type: string
    core_symbols: string[]
    normalized: string
  } {
    const normalized = error
      .replace(/\/[^\s]+\/[^\s]+/g, "<PATH>")
      .replace(/\d+/g, "<N>")
      .replace(/0x[0-9a-fA-F]+/g, "<HEX>")
      .replace(/"([^"]+)"/g, "<STRING>")

    const symbolRegex = /(?:at\s+)?([A-Za-z_][\w.]*(?:\.[\w]+)+)(?:\s|\(|$)/g
    const core_symbols: string[] = []
    let match
    while ((match = symbolRegex.exec(error)) !== null) {
      if (!core_symbols.includes(match[1])) {
        core_symbols.push(match[1])
      }
    }

    const typeMatch = error.match(/(\w+Error|\w+Exception|E\w+)/)
    const error_type = typeMatch ? typeMatch[1] : "UnknownError"

    return { error_type, core_symbols, normalized }
  }
}

export interface RepairDatabase {
  upsertRepairRule(rule: RecoveryRule): void
  getRepairRules(): RecoveryRule[]
}

export class RepairMemoryEngine {
  private errorClassifier = new ErrorClassifier()
  private rules = new Map<string, RecoveryRule>()
  private readonly MAX_RULES = 50
  private db: RepairDatabase | null = null

  /** Connect to a persistent database and load stored rules */
  setDatabase(db: RepairDatabase): void {
    this.db = db
    const persisted = db.getRepairRules()
    for (const rule of persisted) {
      const key = this.getRuleKey(rule.category, rule.tool, rule.condition)
      if (!this.rules.has(key)) {
        this.rules.set(key, rule)
      }
    }
  }

  computeExactHash(error: string): string {
    const { normalized } = this.errorClassifier.extractStructure(error)
    return createHash("md5").update(normalized).digest("hex").substring(0, 16)
  }

  computeFuzzyHash(error: string): string {
    const { error_type, core_symbols } = this.errorClassifier.extractStructure(error)
    const parts = [error_type, ...core_symbols.slice(0, 5)]
    const combined = parts.join("|")
    let hash = 0
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0
    }
    return hash.toString(16).padStart(16, "0")
  }

  hammingDistance(hash1: string, hash2: string): number {
    let distance = 0
    const len = Math.min(hash1.length, hash2.length)
    for (let i = 0; i < len; i++) {
      if (hash1[i] !== hash2[i]) distance++
    }
    return distance
  }

  calculateSpecificity(condition: string, tool: string): number {
    let score = 0
    if (condition.includes("AND")) score += 10
    if (condition.includes("context.contains")) score += 5
    if (condition.includes("tool=") && tool !== "any") score += 3
    if (condition !== "always") score += 1
    return score
  }

  addRule(
    tool: string,
    error: string,
    recoveryAction: string,
  ): RecoveryRule {
    const category = this.errorClassifier.classify(error)
    const exactHash = this.computeExactHash(error)
    const fuzzyHash = this.computeFuzzyHash(error)
    const { error_type, core_symbols } = this.errorClassifier.extractStructure(error)

    const key = this.getRuleKey(category, tool, error)
    const existing = this.rules.get(key)

    if (existing) {
      existing.occurrence_count++
      existing.last_hit = Date.now()
      return existing
    }

    if (this.rules.size >= this.MAX_RULES) {
      const firstKey = this.rules.keys().next().value
      if (firstKey) this.rules.delete(firstKey)
    }

    const condition = this.buildCondition(tool, error)
    const specificity = this.calculateSpecificity(condition, tool)

    const rule: RecoveryRule = {
      repair_id: `repair_${Date.now()}`,
      tool,
      category: category as ErrorCategory,
      condition,
      recovery_action: recoveryAction,
      specificity,
      hit_count: 0,
      last_hit: Date.now(),
      occurrence_count: 1,
      success_rate: 0,
      created_at: Date.now(),
    }

    this.rules.set(key, rule)
    // Persist to DB
    if (this.db) {
      try { this.db.upsertRepairRule(rule) } catch { /* persistence errors must not block */ }
    }
    return rule
  }

  matchRules(tool: string, error: string): RecoveryRule | null {
    const exactHash = this.computeExactHash(error)
    const fuzzyHash = this.computeFuzzyHash(error)
    const category = this.errorClassifier.classify(error)

    const candidates = Array.from(this.rules.values())
      .filter((r) => {
        const ret = this.calculateRetention(r)
        return ret > 0.1
      })
      .sort((a, b) => b.specificity - a.specificity)

    for (const rule of candidates) {
      if (rule.tool === tool && this.computeExactHash(error) === this.computeExactHash(rule.recovery_action)) {
        if (rule.success_rate > 0.8) return rule
      }

      const conditions = rule.condition.split(" AND ").map((c) => c.trim())
      const allMatch = conditions.every((cond) => {
        if (cond.startsWith("tool=")) return tool === cond.split("=")[1].trim().replace(/'/g, "")
        if (cond.startsWith("context.contains(")) {
          const keyword = cond.slice(16, -1)
          return error.includes(keyword)
        }
        return error.includes(cond) || tool.includes(cond)
      })
      if (allMatch) return rule
    }

    for (const rule of candidates) {
      const ruleFuzzyHash = this.computeFuzzyHash(rule.recovery_action)
      if (this.hammingDistance(fuzzyHash, ruleFuzzyHash) <= 3 && rule.success_rate > 0.6) {
        return rule
      }
    }

    for (const rule of candidates) {
      if (rule.category === category) return rule
    }

    return null
  }

  recordResult(ruleId: string, success: boolean): void {
    const rule = this.rules.get(ruleId)
    if (!rule) {
      for (const [key, r] of this.rules) {
        if (r.repair_id === ruleId) {
          r.hit_count++
          r.last_hit = Date.now()
          r.success_rate = (r.success_rate * (r.hit_count - 1) + (success ? 1 : 0)) / r.hit_count

          if (r.success_rate > 0.8 && r.hit_count > 5) {
            r.specificity += 5
          }
          return
        }
      }
      return
    }
    rule.hit_count++
    rule.last_hit = Date.now()
    rule.success_rate = (rule.success_rate * (rule.hit_count - 1) + (success ? 1 : 0)) / rule.hit_count

    if (rule.success_rate > 0.8 && rule.hit_count > 5) {
      rule.specificity += 5
    }
  }

  private calculateRetention(rule: RecoveryRule): number {
    const hours = (Date.now() - (rule.last_hit || rule.created_at)) / 3600000
    return Math.max(0.1, Math.exp(-hours / 168))
  }

  private getRuleKey(category: string, tool: string, condition: string): string {
    if (["not_found", "permission", "timeout"].includes(category)) {
      return `${category}:${condition}`
    }
    return `${category}:${tool}:${condition}`
  }

  private buildCondition(tool: string, error: string): string {
    const parts: string[] = []
    if (tool !== "any") parts.push(`tool='${tool}'`)
    const { error_type } = this.errorClassifier.extractStructure(error)
    if (error_type !== "UnknownError") parts.push(error_type)
    return parts.join(" AND ") || "always"
  }

  getAllRules(): RecoveryRule[] {
    return Array.from(this.rules.values()).sort((a, b) => b.specificity - a.specificity)
  }
}

export * as Repair from "./repair"
