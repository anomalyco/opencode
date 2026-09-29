import { ConfigHitlV1 } from "@opencode-ai/core/v1/config/hitl"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Risk } from "@/permission/risk"

// The gate in Permission.ask always supplies operation and pattern from the
// permission request; call sites only transport the ambient dimensions
// (tool, agent, provider, workspace). A rule dimension absent from the
// context never matches.
export interface Context {
  readonly operation?: string
  readonly pattern?: string
  readonly command?: string
  readonly tool?: string
  readonly agent?: string
  readonly provider?: string
  readonly workspace?: string
}

const THRESHOLD: Record<"SAFE" | "BALANCED" | "STRICT", ConfigHitlV1.Risk> = {
  SAFE: "destructive",
  BALANCED: "moderate",
  STRICT: "routine",
}

// Precedence: an explicit policy rule always wins, then the level risk
// threshold falls back to allow. AUTO preserves the historical behavior of
// adding no confirmations on top of the permission ruleset.
export function evaluate(config: ConfigHitlV1.Info | undefined, context: Context): "allow" | "ask" {
  if (!config) return "allow"
  const risk = Risk.classify(context.operation ?? "", context.command)
  const rule = config.policy?.findLast((item) => matches(item, context, risk))
  if (rule) return rule.action
  const level = config.level ?? "AUTO"
  if (level === "AUTO" || level === "CUSTOM") return "allow"
  const threshold = THRESHOLD[level]
  return Risk.ORDER.indexOf(risk) >= Risk.ORDER.indexOf(threshold) ? "ask" : "allow"
}

function matches(rule: ConfigHitlV1.Rule, context: Context, risk: ConfigHitlV1.Risk): boolean {
  if (rule.tool !== undefined && (!context.tool || !Wildcard.match(context.tool, rule.tool))) return false
  if (rule.agent !== undefined && (!context.agent || !Wildcard.match(context.agent, rule.agent))) return false
  if (rule.provider !== undefined && (!context.provider || !Wildcard.match(context.provider, rule.provider)))
    return false
  if (rule.workspace !== undefined && (!context.workspace || !Wildcard.match(context.workspace, rule.workspace)))
    return false
  if (rule.operation !== undefined && (!context.operation || !Wildcard.match(context.operation, rule.operation)))
    return false
  if (rule.risk !== undefined && rule.risk !== risk) return false
  if (rule.file !== undefined && (!context.pattern || !Wildcard.match(context.pattern, rule.file))) return false
  if (rule.directory !== undefined && (!context.pattern || !within(context.pattern, rule.directory))) return false
  const command = context.command ?? context.pattern
  if (rule.command !== undefined && (!command || !Wildcard.match(command, rule.command))) return false
  return true
}

function within(pattern: string, directory: string) {
  const base = directory.replace(/[\\/]+$/, "")
  return Wildcard.match(pattern, directory) || Wildcard.match(pattern, base + "/*")
}

export * as Hitl from "./hitl"
