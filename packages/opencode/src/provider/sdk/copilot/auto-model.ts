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

type Tier = "fast" | "standard" | "reasoning"

const CLASSIFICATION_PROMPT = `You are a prompt complexity classifier for a coding assistant. Given a user prompt, rate its complexity as a single digit 1-5:

1 = Trivial (greetings, simple questions, one-line changes, "hello", "what is X")
2 = Simple (basic CRUD, standard patterns, short implementations, "write a function to add two numbers")
3 = Moderate (multi-step tasks, API design, refactoring, standard algorithms like binary search or LRU cache)
4 = Complex (advanced algorithms, system design, debugging subtle issues, "design a rate limiter", "implement Dijkstra")
5 = Expert (distributed systems, compiler internals, formal verification, lock-free data structures, consensus protocols)

Reply with ONLY the digit, nothing else.`

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
 * Classify models by credit tier on GitHub Copilot:
 * - Premium (3x credits): Opus, GPT-5.x flagship, Gemini Pro
 * - Standard (1x credits): Sonnet, GPT-4.1, GPT-4o, Grok
 * - Fast (0.25x credits): Mini, Haiku, Flash, Nano
 */
function classifyModel(model: ModelInfo): Tier {
  const id = model.id.toLowerCase()
  // Fast: cheap models (use word boundary to avoid matching "gemini")
  if (/[-.]mini|haiku|flash|nano/.test(id)) return "fast"
  // Reasoning: premium models (3x credits)
  if (/opus/.test(id)) return "reasoning"
  if (/^gpt-5(\.\d+)?$/.test(id)) return "reasoning"  // gpt-5, gpt-5.1, gpt-5.2, gpt-5.4
  if (/^gpt-5\.\d+-codex(-max)?$/.test(id)) return "reasoning"  // gpt-5.1-codex, gpt-5.2-codex, gpt-5.1-codex-max
  if (/gemini.*(pro|2\.5)/.test(id)) return "reasoning"
  // Standard: everything else (1x credits)
  return "standard"
}

// Preferred model families for each tier, checked in order.
const REASONING_PREFERENCE = ["claude-opus-4", "gpt-5.4", "gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-5", "gemini-3-pro", "gemini-2.5-pro"]
const STANDARD_PREFERENCE = ["claude-sonnet-4.6", "claude-sonnet-4.5", "claude-sonnet-4", "gpt-4.1", "gpt-4o", "grok"]
const FAST_PREFERENCE = ["gpt-5-mini", "gpt-5.4-mini", "claude-haiku", "gemini-3-flash", "gemini-2.5-flash"]

function sortByPreference(models: ModelInfo[], preference: string[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const aIdx = preference.findIndex((p) => a.id.includes(p))
    const bIdx = preference.findIndex((p) => b.id.includes(p))
    const aRank = aIdx === -1 ? preference.length : aIdx
    const bRank = bIdx === -1 ? preference.length : bIdx
    if (aRank !== bRank) return aRank - bRank
    // Prefer non-codex models (more widely available)
    const aCodex = a.id.includes("codex") ? 1 : 0
    const bCodex = b.id.includes("codex") ? 1 : 0
    if (aCodex !== bCodex) return aCodex - bCodex
    if (b.limit.output !== a.limit.output) return b.limit.output - a.limit.output
    return b.limit.context - a.limit.context
  })
}

/**
 * CopilotAutoLanguageModel uses GPT-5-mini (free on Copilot) to classify
 * prompt complexity, then routes to the best available model.
 *
 * Rating → Tier:
 *   1-2 → fast (mini/haiku/flash)
 *   3   → standard (sonnet/gpt-4.1)
 *   4-5 → reasoning (opus/codex)
 *
 * Prompts under 20 chars skip classification and go straight to fast.
 * Model tiers are built dynamically from provider metadata.
 */
export class CopilotAutoLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly modelId = "auto"
  readonly provider = "github-copilot.auto"
  readonly supportsStructuredOutputs = false

  private _lastResolvedModelId: string | null = null
  private readonly options: CopilotAutoModelOptions
  private readonly tiers: { reasoning: ModelInfo[]; standard: ModelInfo[]; fast: ModelInfo[] }
  private classifierModel: LanguageModelV3 | null = null
  private unavailableModels = new Set<string>()

  get resolvedModelId(): string | null {
    return this._lastResolvedModelId
  }

  constructor(options: CopilotAutoModelOptions) {
    this.options = options

    const reasoning: ModelInfo[] = []
    const standard: ModelInfo[] = []
    const fast: ModelInfo[] = []

    for (const model of options.models) {
      switch (classifyModel(model)) {
        case "reasoning": reasoning.push(model); break
        case "standard": standard.push(model); break
        case "fast": fast.push(model); break
      }
    }

    this.tiers = {
      reasoning: sortByPreference(reasoning, REASONING_PREFERENCE),
      standard: sortByPreference(standard, STANDARD_PREFERENCE),
      fast: sortByPreference(fast, FAST_PREFERENCE),
    }

    const miniId = fast.find((m) => m.id.includes("gpt-5-mini"))?.id
      ?? fast.find((m) => m.id.includes("mini"))?.id
      ?? fast[0]?.id

    if (miniId) {
      this.classifierModel = options.createModel(miniId)
      log.info("auto model classifier", { classifierModel: miniId })
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

  private getCandidates(tier: Tier): string[] {
    const order: Tier[] =
      tier === "reasoning" ? ["reasoning", "standard", "fast"] :
      tier === "fast" ? ["fast", "standard", "reasoning"] :
      ["standard", "reasoning", "fast"]

    const candidates: string[] = []
    for (const t of order) {
      for (const m of this.tiers[t]) {
        if (!this.unavailableModels.has(m.id)) {
          candidates.push(m.id)
        }
      }
    }
    return candidates.length > 0 ? candidates : [this.options.models[0].id]
  }

  private async classifyWithLLM(promptText: string): Promise<Tier> {
    if (!this.classifierModel) return "standard"

    try {
      const result = await this.classifierModel.doGenerate({
        mode: { type: "regular" },
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: CLASSIFICATION_PROMPT + "\n\nUser prompt: " + promptText.slice(0, 1000) }],
          },
        ],
        maxOutputTokens: 1,
        temperature: 0,
      } as LanguageModelV3CallOptions)

      const text = result.content
        ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim()

      const rating = parseInt(text ?? "", 10)
      if (rating >= 1 && rating <= 5) {
        return rating <= 2 ? "fast" : rating <= 3 ? "standard" : "reasoning"
      }

      log.warn("auto model classifier unexpected output", { output: text })
      return "standard"
    } catch (e) {
      log.warn("auto model classifier failed", { error: e })
      return "standard"
    }
  }

  private async getCandidatesForPrompt(callOptions: LanguageModelV3CallOptions): Promise<string[]> {
    const promptText = extractPromptText(callOptions)

    const classification = promptText.length < 20
      ? "fast" as Tier
      : await this.classifyWithLLM(promptText)

    const candidates = this.getCandidates(classification)

    log.info("auto model candidates", {
      classification,
      candidates: candidates.slice(0, 5),
      promptLength: promptText.length,
    })

    return candidates
  }

  private isModelUnavailableError(error: unknown): boolean {
    const msg = String(error)
    return msg.includes("model_not_supported") ||
      msg.includes("not supported") ||
      msg.includes("does not exist") ||
      msg.includes("not found") ||
      msg.includes("not available")
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const candidates = await this.getCandidatesForPrompt(options)

    for (const modelId of candidates) {
      try {
        this._lastResolvedModelId = modelId
        log.info("auto model trying", { modelId })
        const model = this.options.createModel(modelId)
        return await model.doGenerate(options)
      } catch (e) {
        if (this.isModelUnavailableError(e)) {
          log.warn("auto model unavailable, trying next", { modelId, error: String(e).slice(0, 100) })
          this.unavailableModels.add(modelId)
          continue
        }
        throw e
      }
    }
    throw new Error("auto model: all candidate models are unavailable")
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const candidates = await this.getCandidatesForPrompt(options)

    for (const modelId of candidates) {
      try {
        this._lastResolvedModelId = modelId
        log.info("auto model trying", { modelId })
        const model = this.options.createModel(modelId)
        return await model.doStream(options)
      } catch (e) {
        if (this.isModelUnavailableError(e)) {
          log.warn("auto model unavailable, trying next", { modelId, error: String(e).slice(0, 100) })
          this.unavailableModels.add(modelId)
          continue
        }
        throw e
      }
    }
    throw new Error("auto model: all candidate models are unavailable")
  }
}

export function createCopilotAutoModel(options: CopilotAutoModelOptions): LanguageModelV3 {
  return new CopilotAutoLanguageModel(options)
}
