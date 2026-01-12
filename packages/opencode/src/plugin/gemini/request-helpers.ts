const GEMINI_PREVIEW_LINK = "https://goo.gle/enable-preview-features"

export interface GeminiApiError {
  code?: number
  message?: string
  status?: string
  [key: string]: unknown
}

export interface GeminiApiBody {
  response?: unknown
  error?: GeminiApiError
  [key: string]: unknown
}

export interface GeminiUsageMetadata {
  totalTokenCount?: number
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
}

export interface ThinkingConfig {
  thinkingBudget?: number
  thinkingLevel?: string
  includeThoughts?: boolean
}

export function normalizeThinkingConfig(config: unknown): ThinkingConfig | undefined {
  if (!config || typeof config !== "object") {
    return undefined
  }

  const record = config as Record<string, unknown>
  const budgetRaw = record.thinkingBudget ?? record.thinking_budget
  const levelRaw = record.thinkingLevel ?? record.thinking_level
  const includeRaw = record.includeThoughts ?? record.include_thoughts

  const thinkingBudget = typeof budgetRaw === "number" && Number.isFinite(budgetRaw) ? budgetRaw : undefined
  const thinkingLevel = typeof levelRaw === "string" && levelRaw.length > 0 ? levelRaw.toLowerCase() : undefined
  const includeThoughts = typeof includeRaw === "boolean" ? includeRaw : undefined

  if (thinkingBudget === undefined && thinkingLevel === undefined && includeThoughts === undefined) {
    return undefined
  }

  const normalized: ThinkingConfig = {}
  if (thinkingBudget !== undefined) {
    normalized.thinkingBudget = thinkingBudget
  }
  if (thinkingLevel !== undefined) {
    normalized.thinkingLevel = thinkingLevel
  }
  if (includeThoughts !== undefined) {
    normalized.includeThoughts = includeThoughts
  }
  return normalized
}

export function parseGeminiApiBody(rawText: string): GeminiApiBody | null {
  try {
    const parsed = JSON.parse(rawText)
    if (Array.isArray(parsed)) {
      const firstObject = parsed.find((item: unknown) => typeof item === "object" && item !== null)
      if (firstObject && typeof firstObject === "object") {
        return firstObject as GeminiApiBody
      }
      return null
    }

    if (parsed && typeof parsed === "object") {
      return parsed as GeminiApiBody
    }

    return null
  } catch {
    return null
  }
}

export function extractUsageMetadata(body: GeminiApiBody): GeminiUsageMetadata | null {
  const usage = (body.response && typeof body.response === "object"
    ? (body.response as { usageMetadata?: unknown }).usageMetadata
    : undefined) as GeminiUsageMetadata | undefined

  if (!usage || typeof usage !== "object") {
    return null
  }

  const asRecord = usage as Record<string, unknown>
  const toNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined

  return {
    totalTokenCount: toNumber(asRecord.totalTokenCount),
    promptTokenCount: toNumber(asRecord.promptTokenCount),
    candidatesTokenCount: toNumber(asRecord.candidatesTokenCount),
    cachedContentTokenCount: toNumber(asRecord.cachedContentTokenCount),
  }
}

export function rewriteGeminiPreviewAccessError(
  body: GeminiApiBody,
  status: number,
  requestedModel?: string,
): GeminiApiBody | null {
  if (!needsPreviewAccessOverride(status, body, requestedModel)) {
    return null
  }

  const error: GeminiApiError = body.error ?? {}
  const trimmedMessage = typeof error.message === "string" ? error.message.trim() : ""
  const messagePrefix =
    trimmedMessage.length > 0 ? trimmedMessage : "Gemini 3 preview features are not enabled for this account."
  const enhancedMessage = `${messagePrefix} Request preview access at ${GEMINI_PREVIEW_LINK} before using Gemini 3 models.`

  return {
    ...body,
    error: {
      ...error,
      message: enhancedMessage,
    },
  }
}

function needsPreviewAccessOverride(status: number, body: GeminiApiBody, requestedModel?: string): boolean {
  if (status !== 404) {
    return false
  }

  if (isGeminiThreeModel(requestedModel)) {
    return true
  }

  const errorMessage = typeof body.error?.message === "string" ? body.error.message : ""
  return isGeminiThreeModel(errorMessage)
}

function isGeminiThreeModel(target?: string): boolean {
  if (!target) {
    return false
  }

  return /gemini[\s-]?3/i.test(target)
}
