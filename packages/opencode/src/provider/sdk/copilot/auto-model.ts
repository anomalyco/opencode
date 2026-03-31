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

function classifyModel(model: ModelInfo): Tier {
  const lower = model.id.toLowerCase()
  if (/mini|haiku|flash|nano/.test(lower)) return "fast"
  if (model.capabilities.reasoning && model.limit.output > 16384) return "reasoning"
  return "standard"
}

function sortByCapability(a: ModelInfo, b: ModelInfo): number {
  if (b.limit.output !== a.limit.output) return b.limit.output - a.limit.output
  return b.limit.context - a.limit.context
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
      reasoning: reasoning.sort(sortByCapability),
      standard: standard.sort(sortByCapability),
      fast: fast.sort(sortByCapability),
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

  private pickFromTier(tier: Tier): string {
    const order: Tier[] =
      tier === "reasoning" ? ["reasoning", "standard", "fast"] :
      tier === "fast" ? ["fast", "standard", "reasoning"] :
      ["standard", "reasoning", "fast"]

    for (const t of order) {
      if (this.tiers[t].length > 0) return this.tiers[t][0].id
    }
    return this.options.models[0].id
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

  private async resolveModel(callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3> {
    const promptText = extractPromptText(callOptions)

    const classification = promptText.length < 20
      ? "fast" as Tier
      : await this.classifyWithLLM(promptText)

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
    const model = await this.resolveModel(options)
    return model.doGenerate(options)
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const model = await this.resolveModel(options)
    return model.doStream(options)
  }
}

export function createCopilotAutoModel(options: CopilotAutoModelOptions): LanguageModelV3 {
  return new CopilotAutoLanguageModel(options)
}
