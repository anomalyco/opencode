/**
 * ANR processor hooks — telemetry, quota enforcement, audit, and credential refresh.
 * These are called from the Effect-based processor at key lifecycle points.
 * All hooks are guarded by `process.env.OPENCODE_FLAVOR === "anr"` and silently no-op otherwise.
 */
import {
  trackModelCall,
  getTelemetryContext,
  logTokenUsage,
  flushOTEL,
  trackLinesOfCode,
  trackCodeEditTool,
  trackCodeEditDecision,
  trackCommit,
  checkQuota,
  QuotaExceededError,
} from "@opencode-ai/anr-core"
import { refresh as refreshANRCredentials } from "@/auth/anr-refresh"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.anr-hooks" })

const isANR = () => process.env.OPENCODE_FLAVOR === "anr"

const EXPIRED_TOKEN_PATTERNS = [
  /expired.*token/i,
  /token.*expired/i,
  /security token.*expired/i,
  /request has expired/i,
  /credentials have expired/i,
  /UnrecognizedClientException/i,
]

export function isExpiredTokenError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : typeof (e as any)?.message === "string" ? (e as any).message : String(e)
  if (EXPIRED_TOKEN_PATTERNS.some((p) => p.test(message))) return true
  if (typeof (e as any)?.responseBody === "string") {
    if (EXPIRED_TOKEN_PATTERNS.some((p) => p.test((e as any).responseBody))) return true
  }
  if ((e as any)?.statusCode === 403 && /credential|token|security/i.test(message)) return true
  if ((e as any)?.statusCode === 401 || (e as any)?.status === 401) return true
  return false
}

/**
 * Pre-call quota check. Throws QuotaExceededError if over limit.
 * Updates process.env with latest quota percentages for UI.
 */
export async function enforceQuota(): Promise<void> {
  if (!isANR() || !process.env.OPENCODE_API_ENDPOINT) return

  const email = process.env.OPENCODE_ANR_USER_EMAIL || ""
  const result = await checkQuota(
    { userEmail: email },
    process.env.OPENCODE_API_ENDPOINT,
    (process.env.QUOTA_FAIL_MODE as "closed" | "open") || "closed",
    process.env.OPENCODE_ANR_ID_TOKEN,
  )
  if (result) {
    process.env.OPENCODE_ANR_QUOTA_ALLOWED = String(result.usage.allowed)
    process.env.OPENCODE_ANR_QUOTA_WARNING_LEVEL = result.usage.warningLevel
    process.env.OPENCODE_ANR_QUOTA_DAILY_PERCENT = String(result.usage.dailyUsagePercent)
    process.env.OPENCODE_ANR_QUOTA_MONTHLY_PERCENT = String(result.usage.monthlyUsagePercent)
  }
  if (result && !result.usage.allowed) {
    throw new QuotaExceededError(result.usage, result.policy)
  }
}

/**
 * Post-step telemetry: track model call metrics, flush OTEL, write audit log.
 */
export function trackStepFinish(input: {
  modelId: string
  modelName: string
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
  costInput: number
  costOutput: number
}): void {
  if (!isANR()) return

  try {
    const context = getTelemetryContext()
    const cost =
      (input.tokensInput * input.costInput + input.tokensOutput * input.costOutput) / 1_000_000

    trackModelCall(
      input.modelId || input.modelName,
      input.tokensInput,
      input.tokensOutput,
      input.tokensReasoning,
      input.tokensCacheRead,
      input.tokensCacheWrite,
      context || undefined,
      cost,
      process.cwd(),
    )

    flushOTEL()

    if (context) {
      const auditConfig = {
        auditTableName: process.env.AUDIT_TABLE_NAME || "AuditEvents",
        awsRegion: process.env.AWS_REGION || "us-east-2",
      } as any

      logTokenUsage(
        auditConfig,
        context.userId,
        input.modelName || input.modelId,
        input.tokensInput,
        input.tokensOutput,
        context,
      )
    }
  } catch (err) {
    // Silently fail — don't block model calls if telemetry fails
    log.warn("trackStepFinish failed", { error: err instanceof Error ? err.message : String(err) })
  }
}

const EXT_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", rb: "ruby",
  cpp: "cpp", c: "c", cs: "csharp", swift: "swift", kt: "kotlin",
  sh: "shell", bash: "shell", zsh: "shell", md: "markdown",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  html: "html", css: "css", scss: "scss", sql: "sql",
}

/**
 * Track code edit metrics after a successful tool-result.
 */
export function trackToolResult(tool: string, input: Record<string, any>): void {
  if (!isANR()) return

  try {
    const ext = (input.filePath || input.file_path || "").split(".").pop()?.toLowerCase() || ""
    const lang = EXT_MAP[ext] || ext || "unknown"

    if (tool === "edit" && input.oldString !== undefined && input.newString !== undefined) {
      const removed = input.oldString.split("\n").length
      const added = input.newString.split("\n").length
      trackLinesOfCode(added, "added", lang)
      trackLinesOfCode(removed, "removed", lang)
      trackCodeEditTool("edit", lang, true)
      trackCodeEditDecision("accepted", lang)
    } else if (tool === "write" && input.content !== undefined) {
      const lines = input.content.split("\n").length
      trackLinesOfCode(lines, "added", lang)
      trackCodeEditTool("write", lang, true)
      trackCodeEditDecision("accepted", lang)
    } else if (tool === "multiedit" && Array.isArray(input.edits)) {
      let added = 0
      let removed = 0
      for (const e of input.edits) {
        if (e.oldString !== undefined) removed += e.oldString.split("\n").length
        if (e.newString !== undefined) added += e.newString.split("\n").length
      }
      trackLinesOfCode(added, "added", lang)
      trackLinesOfCode(removed, "removed", lang)
      trackCodeEditTool("multiedit", lang, true)
      trackCodeEditDecision("accepted", lang)
    } else if (tool === "apply_patch" && input.patchText) {
      const lines = (input.patchText as string).split("\n")
      const added = lines.filter((l: string) => l.startsWith("+") && !l.startsWith("+++")).length
      const removed = lines.filter((l: string) => l.startsWith("-") && !l.startsWith("---")).length
      trackLinesOfCode(added, "added")
      trackLinesOfCode(removed, "removed")
      trackCodeEditTool("apply_patch", "mixed", true)
      trackCodeEditDecision("accepted", "mixed")
    } else if (tool === "bash" && typeof input.command === "string" && /\bgit\s+commit\b/.test(input.command)) {
      trackCommit()
    }
  } catch {
    // silently fail — don't block tool results
  }
}

/**
 * Attempt credential refresh when an expired token error is detected.
 * Returns true if credentials were successfully refreshed and retry is possible.
 */
export async function attemptCredentialRefresh(e: unknown): Promise<boolean> {
  if (!isANR() || !isExpiredTokenError(e)) return false

  log.info("detected expired token, attempting credential refresh")
  const refreshed = await refreshANRCredentials()
  if (refreshed) {
    log.info("credentials refreshed, retry possible")
    return true
  }
  log.error("credential refresh failed")
  return false
}
