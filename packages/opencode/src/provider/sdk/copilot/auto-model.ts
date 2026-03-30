import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider"
import { Log } from "@/util/log"

const log = Log.create({ service: "copilot-auto" })

interface CopilotAutoModelOptions {
  providerModels: string[]
  createModel: (modelId: string) => LanguageModelV3
}

/**
 * Model tiers for client-side routing.
 * Ordered from most capable (reasoning-heavy) to lightweight.
 */
const REASONING_MODELS = ["claude-opus-4.6", "claude-opus-4.5", "claude-opus-41", "gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5"]
const STANDARD_MODELS = ["claude-sonnet-4.6", "claude-sonnet-4.5", "claude-sonnet-4", "gpt-5.1-codex", "gpt-5.2-codex", "gpt-5.3-codex", "gemini-3-pro-preview", "gemini-2.5-pro", "gpt-4.1"]
const FAST_MODELS = ["gpt-5-mini", "gpt-5.4-mini", "gpt-5.1-codex-mini", "claude-haiku-4.5", "gemini-3-flash-preview"]

/**
 * Simple heuristics to classify a prompt's complexity.
 */
function classifyPrompt(promptText: string): "reasoning" | "standard" | "fast" {
  const lower = promptText.toLowerCase()
  const len = promptText.length

  // Short simple prompts → fast model
  if (len < 100) return "fast"

  // Reasoning indicators
  const reasoningPatterns = [
    /\b(explain|why|analyze|compare|trade.?off|architect|design|plan|debug|refactor|review|security|audit)\b/,
    /\b(complex|difficult|tricky|subtle|edge.?case|race.?condition|concurren)/,
    /\b(step.?by.?step|think|reason|consider|evaluate)\b/,
    /\b(optimize|performance|algorithm|data.?structure)\b/,
  ]
  if (reasoningPatterns.some((p) => p.test(lower))) return "reasoning"

  // Long prompts with code → standard
  if (len > 2000) return "standard"

  // Code-heavy prompts → standard
  if ((promptText.match(/```/g)?.length ?? 0) >= 2) return "standard"
  if ((promptText.match(/\n/g)?.length ?? 0) > 20) return "standard"

  // Default to standard
  return "standard"
}

function extractPromptText(options: LanguageModelV3CallOptions): string {
  const parts: string[] = []
  for (const msg of options.prompt) {
    if (msg.role === "user") {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push(part.text)
        }
      }
    }
  }
  return parts.join("\n")
}

/**
 * CopilotAutoLanguageModel implements LanguageModelV3 and automatically
 * selects the best available model for each request using client-side
 * heuristics based on prompt complexity.
 *
 * The Copilot server-side routing API (/models/session) is restricted to
 * first-party clients (VS Code). This implementation provides equivalent
 * functionality using local classification:
 *
 * - Reasoning-heavy prompts → most capable model (Opus, GPT-5.4, etc.)
 * - Standard coding tasks → balanced model (Sonnet, Codex, GPT-4.1, etc.)
 * - Simple/short prompts → fast model (Mini, Haiku, Flash, etc.)
 */
export class CopilotAutoLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly modelId = "auto"
  readonly provider = "github-copilot.auto"
  readonly supportsStructuredOutputs = false

  private readonly options: CopilotAutoModelOptions

  constructor(options: CopilotAutoModelOptions) {
    this.options = options
  }

  get supportedUrls() {
    return {}
  }

  private findBestAvailable(tier: string[]): string | undefined {
    for (const model of tier) {
      if (this.options.providerModels.some((m) => m.includes(model))) {
        return this.options.providerModels.find((m) => m.includes(model))
      }
    }
    return undefined
  }

  private resolveModel(callOptions: LanguageModelV3CallOptions): LanguageModelV3 {
    const promptText = extractPromptText(callOptions)
    const classification = classifyPrompt(promptText)

    let selectedModelId: string | undefined
    switch (classification) {
      case "reasoning":
        selectedModelId = this.findBestAvailable(REASONING_MODELS)
          ?? this.findBestAvailable(STANDARD_MODELS)
          ?? this.findBestAvailable(FAST_MODELS)
        break
      case "standard":
        selectedModelId = this.findBestAvailable(STANDARD_MODELS)
          ?? this.findBestAvailable(REASONING_MODELS)
          ?? this.findBestAvailable(FAST_MODELS)
        break
      case "fast":
        selectedModelId = this.findBestAvailable(FAST_MODELS)
          ?? this.findBestAvailable(STANDARD_MODELS)
          ?? this.findBestAvailable(REASONING_MODELS)
        break
    }

    if (!selectedModelId) {
      // Ultimate fallback: first available model
      selectedModelId = this.options.providerModels[0]
    }

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
