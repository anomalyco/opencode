import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider"
import { Log } from "@/util/log"

const log = Log.create({ service: "copilot-auto" })

interface ModelInfo {
  id: string
  name: string
  capabilities: {
    reasoning: boolean
    toolcall: boolean
  }
  limit: {
    context: number
    output: number
  }
}

interface CopilotAutoModelOptions {
  models: ModelInfo[]
  createModel: (modelId: string) => LanguageModelV3
}

/**
 * Classify prompt complexity based on the last user message.
 */
function classifyPrompt(promptText: string): "reasoning" | "standard" | "fast" {
  const lower = promptText.toLowerCase()
  const len = promptText.length

  if (len < 100) return "fast"

  const reasoningPatterns = [
    /\b(explain|why|analyze|compare|trade.?off|architect|design|plan|debug|refactor|review|security|audit)\b/,
    /\b(complex|difficult|tricky|subtle|edge.?case|race.?condition|concurren)/,
    /\b(step.?by.?step|think|reason|consider|evaluate)\b/,
    /\b(optimize|performance|algorithm|data.?structure)\b/,
  ]
  if (reasoningPatterns.some((p) => p.test(lower))) return "reasoning"

  if (len > 2000) return "standard"
  if ((promptText.match(/```/g)?.length ?? 0) >= 2) return "standard"
  if ((promptText.match(/\n/g)?.length ?? 0) > 20) return "standard"

  return "standard"
}

/**
 * Extract only the last user message for classification.
 */
function extractPromptText(options: LanguageModelV3CallOptions): string {
  const parts: string[] = []
  for (let i = options.prompt.length - 1; i >= 0; i--) {
    const msg = options.prompt[i]
    if (msg.role === "user") {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push(part.text)
        }
      }
      break
    }
  }
  return parts.join("\n")
}

/**
 * Classify a model into a tier based on its metadata.
 *
 * - "reasoning": has reasoning capability and large output limits (>16K)
 * - "fast": small output limit (<8K) or name contains mini/haiku/flash/nano
 * - "standard": everything else
 */
function classifyModel(model: ModelInfo): "reasoning" | "standard" | "fast" {
  const lower = model.id.toLowerCase()

  if (/mini|haiku|flash|nano/.test(lower)) return "fast"

  if (model.capabilities.reasoning && model.limit.output > 16384) return "reasoning"

  return "standard"
}

/**
 * Sort models within a tier by capability (larger context/output first).
 */
function sortByCapability(a: ModelInfo, b: ModelInfo): number {
  if (b.limit.output !== a.limit.output) return b.limit.output - a.limit.output
  return b.limit.context - a.limit.context
}

/**
 * CopilotAutoLanguageModel selects the best available model for each
 * request using the model metadata from the provider (capabilities,
 * context limits, output limits) — no hardcoded model lists.
 */
export class CopilotAutoLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly modelId = "auto"
  readonly provider = "github-copilot.auto"
  readonly supportsStructuredOutputs = false

  private _lastResolvedModelId: string | null = null
  private readonly options: CopilotAutoModelOptions
  private readonly tiers: {
    reasoning: ModelInfo[]
    standard: ModelInfo[]
    fast: ModelInfo[]
  }

  get resolvedModelId(): string | null {
    return this._lastResolvedModelId
  }

  constructor(options: CopilotAutoModelOptions) {
    this.options = options

    const reasoning: ModelInfo[] = []
    const standard: ModelInfo[] = []
    const fast: ModelInfo[] = []

    for (const model of options.models) {
      const tier = classifyModel(model)
      switch (tier) {
        case "reasoning": reasoning.push(model); break
        case "standard": standard.push(model); break
        case "fast": fast.push(model); break
      }
    }

    this.tiers = {
      reasoning: reasoning.sort(sortByCapability),
      standard: standard.sort(sortByCapability),
      fast: fast.sort(sortByCapability),
    }

    log.info("auto model tiers", {
      reasoning: this.tiers.reasoning.map((m) => m.id),
      standard: this.tiers.standard.map((m) => m.id),
      fast: this.tiers.fast.map((m) => m.id),
    })
  }

  get supportedUrls() {
    return {}
  }

  private pickFromTier(classification: "reasoning" | "standard" | "fast"): string {
    const order: Array<"reasoning" | "standard" | "fast"> =
      classification === "reasoning" ? ["reasoning", "standard", "fast"] :
      classification === "fast" ? ["fast", "standard", "reasoning"] :
      ["standard", "reasoning", "fast"]

    for (const tier of order) {
      if (this.tiers[tier].length > 0) {
        return this.tiers[tier][0].id
      }
    }

    // Ultimate fallback
    return this.options.models[0].id
  }

  private resolveModel(callOptions: LanguageModelV3CallOptions): LanguageModelV3 {
    const promptText = extractPromptText(callOptions)
    const classification = classifyPrompt(promptText)
    const selectedModelId = this.pickFromTier(classification)

    this._lastResolvedModelId = selectedModelId
    log.info("auto model selected", {
      classification,
      modelId: selectedModelId,
      promptLength: promptText.length,
    })

    return this.options.createModel(selectedModelId)
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const model = this.resolveModel(options)
    return model.doGenerate(options)
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const model = this.resolveModel(options)
    return model.doStream(options)
  }
}

export function createCopilotAutoModel(options: CopilotAutoModelOptions): LanguageModelV3 {
  return new CopilotAutoLanguageModel(options)
}
