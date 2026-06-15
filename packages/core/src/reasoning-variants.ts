export * as ReasoningVariants from "./reasoning-variants"

// Generates reasoning variants from models.dev `reasoning_options` data. The
// data only says which efforts a model supports; this module owns the wire
// encoding so catalog and provider paths stay in sync.

export const INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"] as const

export interface Target {
  readonly npm?: string
  readonly apiID: string
  readonly modelID: string
  readonly providerID: string
}

export function fromOptions(
  target: Target,
  options: ReadonlyArray<{ readonly type: string; readonly values?: ReadonlyArray<string | null> }> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  const efforts = [
    ...new Set(
      (options ?? [])
        .flatMap((option) => (option.type === "effort" ? (option.values ?? []) : []))
        .filter((value): value is string => typeof value === "string"),
    ),
  ]
  if (efforts.length === 0) return undefined
  return effortVariants(target, efforts)
}

export function anthropicOpus47OrLater(apiID: string) {
  const version = /opus-(\d+)[.-](\d+)(?:[.@-]|$)|claude-(\d+)[.-](\d+)-opus(?:[.@-]|$)/i.exec(apiID)
  if (!version) return false
  const major = Number(version[1] ?? version[3])
  const minor = Number(version[2] ?? version[4])
  return major > 4 || (major === 4 && minor >= 7)
}

export function anthropicAdaptiveEfforts(apiID: string): string[] | null {
  if (anthropicOpus47OrLater(apiID) || apiID.includes("fable-5")) {
    return ["low", "medium", "high", "xhigh", "max"]
  }
  if (
    ["opus-4-6", "opus-4.6", "4-6-opus", "4.6-opus", "sonnet-4-6", "sonnet-4.6", "4-6-sonnet", "4.6-sonnet"].some((v) =>
      apiID.includes(v),
    )
  ) {
    return ["low", "medium", "high", "max"]
  }
  return null
}

export function anthropicOmitsThinking(apiID: string) {
  return anthropicOpus47OrLater(apiID) || apiID.includes("fable-5")
}

export function wrapInSapModelParams(
  variants: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(variants).map(([id, value]) => [id, { modelParams: value }]))
}

function copilotAnthropicEfforts(apiID: string, efforts: string[]) {
  if (apiID.includes("opus-4.7")) return ["medium"]
  return efforts.filter((value) => value !== "max" && value !== "xhigh")
}

function anthropicEffortVariants(target: Target, efforts: string[]): Record<string, Record<string, unknown>> {
  const filtered = target.providerID === "github-copilot" ? copilotAnthropicEfforts(target.apiID, efforts) : efforts
  const adaptive = anthropicAdaptiveEfforts(target.apiID) !== null
  return Object.fromEntries(
    filtered.map((effort) => [
      effort,
      adaptive
        ? {
            thinking: {
              type: "adaptive",
              ...(anthropicOmitsThinking(target.apiID) ? { display: "summarized" } : {}),
            },
            effort,
          }
        : { effort },
    ]),
  )
}

function effortVariants(target: Target, efforts: string[]): Record<string, Record<string, unknown>> {
  const fromEffort = (encode: (effort: string) => Record<string, unknown>) =>
    Object.fromEntries(efforts.map((effort) => [effort, encode(effort)]))

  switch (target.npm) {
    case "@openrouter/ai-sdk-provider":
      return fromEffort((effort) => ({ reasoning: { effort } }))

    case "@ai-sdk/gateway":
      if (target.modelID.includes("anthropic")) return anthropicEffortVariants(target, efforts)
      if (target.modelID.includes("google"))
        return fromEffort((effort) => ({ includeThoughts: true, thinkingLevel: effort }))
      return fromEffort((effort) => ({ reasoningEffort: effort }))

    case "@ai-sdk/github-copilot":
      if (target.modelID.includes("gemini")) return {}
      if (target.modelID.includes("claude")) return fromEffort((effort) => ({ reasoningEffort: effort }))
      return fromEffort((effort) => ({
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: INCLUDE_ENCRYPTED_REASONING,
      }))

    case "@ai-sdk/azure":
    case "@ai-sdk/amazon-bedrock/mantle":
    case "@ai-sdk/openai":
      return fromEffort((effort) => ({
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: INCLUDE_ENCRYPTED_REASONING,
      }))

    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return anthropicEffortVariants(target, efforts)

    case "@ai-sdk/amazon-bedrock":
      if (anthropicAdaptiveEfforts(target.apiID)) {
        return fromEffort((effort) => ({
          reasoningConfig: {
            type: "adaptive",
            maxReasoningEffort: effort,
            ...(anthropicOmitsThinking(target.apiID) ? { display: "summarized" } : {}),
          },
        }))
      }
      return fromEffort((effort) => ({
        reasoningConfig: {
          type: "enabled",
          maxReasoningEffort: effort,
        },
      }))

    case "@ai-sdk/google-vertex":
    case "@ai-sdk/google":
      return fromEffort((effort) => ({ thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }))

    case "@jerome-benoit/sap-ai-provider-v2": {
      if (target.modelID.toLowerCase().includes("anthropic")) {
        const adaptive = anthropicAdaptiveEfforts(target.apiID) !== null
        return wrapInSapModelParams(
          fromEffort((effort) =>
            adaptive
              ? {
                  thinking: {
                    type: "adaptive",
                    ...(anthropicOmitsThinking(target.apiID) ? { display: "summarized" } : {}),
                  },
                  output_config: { effort },
                }
              : { output_config: { effort } },
          ),
        )
      }
      return wrapInSapModelParams(fromEffort((effort) => ({ reasoning_effort: effort })))
    }
  }

  return fromEffort((effort) => ({ reasoningEffort: effort }))
}
