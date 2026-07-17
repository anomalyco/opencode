import { destructiveReason } from "./destructive"

export type InstructionIntent = {
  intent: "high" | "low"
  reason: string
}

const READ_PERMISSIONS = new Set(["read", "grep", "glob", "list", "webfetch", "websearch", "skill", "task"])
const PROJECT_WRITE_PERMISSIONS = new Set(["edit", "write", "apply_patch"])

function patternText(patterns: readonly string[], metadata?: Record<string, unknown>): string {
  const parts = patterns.map((pattern) => pattern.trim()).filter(Boolean)
  const command = metadata?.command
  if (typeof command === "string" && command.trim()) parts.push(command.trim())
  return parts.join("\n").toLowerCase()
}

function harmlessBash(patterns: readonly string[], metadata?: Record<string, unknown>): boolean {
  const text = patternText(patterns, metadata)
  if (!text) return false
  return /^(?:echo|pwd|ls|true)\b/.test(text.trim())
}

function localGitInspect(patterns: readonly string[], metadata?: Record<string, unknown>): boolean {
  const text = patternText(patterns, metadata)
  if (!/\bgit\b/.test(text)) return false
  if (/\b(reset|rebase|push|filter-branch)\b/.test(text)) return false
  return true
}

function gitHistoryRewrite(patterns: readonly string[], metadata?: Record<string, unknown>): boolean {
  const text = patternText(patterns, metadata)
  return /\bgit\b/.test(text) && /\b(reset|rebase|filter-branch)\b/.test(text)
}

function projectPackageInstall(patterns: readonly string[], metadata?: Record<string, unknown>): boolean {
  const text = patternText(patterns, metadata)
  return /\b(npm|pnpm|yarn|bun)\s+(install|add|ci)\b/.test(text) && !/\b(-g|--global)\b/.test(text)
}

/**
 * Deterministic host-side instruction fit for Allow / Conditional sections.
 * Returns high intent when the pending action clearly matches configured allow or conditional guidance.
 */
export function matchesAllowOrConditionalInstructions(
  permission: string,
  patterns: readonly string[],
  metadata?: Record<string, unknown>,
): InstructionIntent | undefined {
  if (READ_PERMISSIONS.has(permission)) {
    return { intent: "high", reason: "Read or search tools inside the project workspace are allowed." }
  }
  if (PROJECT_WRITE_PERMISSIONS.has(permission)) {
    return { intent: "high", reason: "Routine project-scoped edits and writes are allowed." }
  }
  if (permission === "bash" && harmlessBash(patterns, metadata)) {
    return { intent: "high", reason: "Harmless shell commands that only inspect or print output are allowed." }
  }
  if (permission === "bash" && localGitInspect(patterns, metadata)) {
    return { intent: "high", reason: "Local git inspect or commit commands are conditionally allowed." }
  }
  if (permission === "bash" && projectPackageInstall(patterns, metadata)) {
    return { intent: "high", reason: "Project-scoped package installs are conditionally allowed." }
  }
  return undefined
}

/**
 * Deterministic host-side instruction fit for Deny section.
 * Deny wins over allow/conditional when both could apply.
 */
export function matchesDenyInstructions(
  permission: string,
  patterns: readonly string[],
  metadata?: Record<string, unknown>,
): InstructionIntent | undefined {
  const destructive = destructiveReason(permission, patterns)
  if (destructive) return { intent: "low", reason: destructive }

  const text = patternText(patterns, metadata)
  if (permission === "bash" && gitHistoryRewrite(patterns, metadata)) {
    return { intent: "low", reason: "Git history rewrite requires clear explicit user intent." }
  }
  if (permission === "bash" && /\bgit\b/.test(text) && /\bpush\b/.test(text) && /\b(main|master)\b/.test(text)) {
    return { intent: "low", reason: "Force-push to main/master is denied." }
  }
  return undefined
}

export type DeriveInstructionIntentInput = {
  permission: string
  patterns: readonly string[]
  metadata?: Record<string, unknown>
  modelIntent: "high" | "medium" | "low"
  hasExplicitPrompt: boolean
  explicitApproval: boolean
}

/**
 * Resolve final intent from instruction fit, explicit approval, and model assessment.
 * Precedence: explicit approval → high; deny instruction fit → low; allow/conditional fit → high;
 * otherwise keep model intent, capping unauthorized high intent without an explicit prompt.
 */
export function deriveInstructionIntent(input: DeriveInstructionIntentInput): {
  intent: "high" | "medium" | "low"
  reason: string
} {
  if (input.explicitApproval) {
    return { intent: "high", reason: "User approved the assistant permission request for this action." }
  }

  const deny = matchesDenyInstructions(input.permission, input.patterns, input.metadata)
  if (deny) return deny

  const allow = matchesAllowOrConditionalInstructions(input.permission, input.patterns, input.metadata)
  if (allow) return allow

  if (input.modelIntent === "high" && !input.hasExplicitPrompt) {
    return {
      intent: "medium",
      reason: "High intent requires an explicit current user prompt.",
    }
  }

  return {
    intent: input.modelIntent,
    reason: "Classifier assessment.",
  }
}
