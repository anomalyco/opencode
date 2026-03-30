import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { Log } from "@/util/log"

const log = Log.create({ service: "copilot-auto" })

// 5 minutes before expiry, refresh the session token
const SESSION_REFRESH_BUFFER_MS = 5 * 60 * 1000

export interface CopilotAutoModelSession {
  availableModels: string[]
  sessionToken: string
  expiresAt: number
  discountedCosts?: Record<string, number>
}

interface CopilotAutoModelOptions {
  baseURL: string
  fetch: FetchFunction
  headers: () => Record<string, string | undefined>
  createModel: (modelId: string, extraHeaders?: Record<string, string>) => LanguageModelV3
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
  return parts.join("\n").slice(0, 4096)
}

function hasImageContent(options: LanguageModelV3CallOptions): boolean {
  for (const msg of options.prompt) {
    if (msg.role !== "user") continue
    for (const part of msg.content) {
      if (part.type === "image") return true
    }
  }
  return false
}

/**
 * CopilotAutoLanguageModel implements LanguageModelV3 and automatically
 * selects the best model for each request using GitHub Copilot's
 * /models/session and /models/session/intent APIs.
 *
 * Protocol (reverse-engineered from VS Code Copilot Chat extension):
 *
 * 1. POST /models/session  — creates an auto-mode session, returns
 *    available_models, session_token, expires_at, discounted_costs
 *
 * 2. POST /models/session/intent  — per-turn routing, sends prompt text
 *    and available models. The session_token is passed via the
 *    Copilot-Session-Token header. Returns candidate_models ranked by
 *    suitability.
 *
 * 3. The selected model's chat/responses request also receives the
 *    Copilot-Session-Token header for billing discount tracking.
 */
export class CopilotAutoLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly modelId = "auto"
  readonly provider = "github-copilot.auto"
  readonly supportsStructuredOutputs = false

  private session: CopilotAutoModelSession | null = null
  private lastModelId: string | null = null
  private lastPrompt: string | null = null
  private turnNumber = 0
  private readonly options: CopilotAutoModelOptions

  constructor(options: CopilotAutoModelOptions) {
    this.options = options
  }

  get supportedUrls() {
    return {}
  }

  private isSessionExpired(): boolean {
    if (!this.session) return true
    return Date.now() >= this.session.expiresAt * 1000 - SESSION_REFRESH_BUFFER_MS
  }

  private async ensureSession(): Promise<CopilotAutoModelSession> {
    if (this.session && !this.isSessionExpired()) return this.session

    const url = `${this.options.baseURL}/models/session`
    log.info("creating auto model session", { url })

    const headers = this.options.headers()
    const response = await this.options.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        auto_mode: {
          model_hints: ["auto"],
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to create auto model session: ${response.status} ${text}`)
    }

    const data = (await response.json()) as {
      available_models: string[]
      session_token: string
      expires_at: number
      discounted_costs?: Record<string, number>
    }

    log.info("auto model session created", {
      availableModels: data.available_models,
      expiresAt: data.expires_at,
    })

    this.session = {
      availableModels: data.available_models,
      sessionToken: data.session_token,
      expiresAt: data.expires_at,
      discountedCosts: data.discounted_costs,
    }

    return this.session
  }

  private async resolveModel(callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3> {
    const session = await this.ensureSession()
    const promptText = extractPromptText(callOptions)

    // Skip router for image requests — VS Code falls back to vision-capable model selection
    if (hasImageContent(callOptions)) {
      const fallbackModelId = session.availableModels[0]
      log.info("auto model skipping router for image request", { modelId: fallbackModelId })
      this.lastModelId = fallbackModelId
      return this.options.createModel(fallbackModelId, {
        "Copilot-Session-Token": session.sessionToken,
      })
    }

    // Same prompt as last turn — reuse previous decision
    if (promptText && promptText === this.lastPrompt && this.lastModelId) {
      log.info("auto model reusing previous routing", { modelId: this.lastModelId })
      return this.options.createModel(this.lastModelId, {
        "Copilot-Session-Token": session.sessionToken,
      })
    }

    this.turnNumber++
    this.lastPrompt = promptText

    const url = `${this.options.baseURL}/models/session/intent`
    log.info("routing auto model", {
      turnNumber: this.turnNumber,
      promptLength: promptText.length,
      availableModels: session.availableModels,
    })

    const headers = this.options.headers()

    try {
      const response = await this.options.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Copilot-Session-Token": session.sessionToken,
          ...headers,
        },
        body: JSON.stringify({
          prompt: promptText,
          available_models: session.availableModels,
          turn_number: this.turnNumber,
          previous_model: this.lastModelId,
          prompt_char_count: promptText.length,
          reference_count: 0,
          session_id: undefined,
          sticky_threshold: undefined,
        }),
      })

      if (response.ok) {
        const data = (await response.json()) as {
          predicted_label?: string
          confidence?: number
          candidate_models: string[]
          sticky_override?: boolean
        }

        if (data.candidate_models && data.candidate_models.length > 0) {
          const selectedModelId = data.candidate_models[0]
          log.info("auto model selected", {
            modelId: selectedModelId,
            predictedLabel: data.predicted_label,
            confidence: data.confidence,
            stickyOverride: data.sticky_override,
          })
          this.lastModelId = selectedModelId
          return this.options.createModel(selectedModelId, {
            "Copilot-Session-Token": session.sessionToken,
          })
        } else {
          log.warn("auto model router returned empty candidates")
        }
      } else {
        log.warn("auto model routing failed, using fallback", {
          status: response.status,
        })
      }
    } catch (e) {
      log.warn("auto model routing error, using fallback", { error: e })
    }

    // Fallback: prefer same provider as previous model, else first available
    const fallbackModelId = this.selectFallbackModel(session)
    log.info("auto model fallback", { modelId: fallbackModelId })
    this.lastModelId = fallbackModelId
    return this.options.createModel(fallbackModelId, {
      "Copilot-Session-Token": session.sessionToken,
    })
  }

  private selectFallbackModel(session: CopilotAutoModelSession): string {
    if (this.lastModelId) {
      // Try to find a model from the same provider family
      const lastProvider = this.lastModelId.split("-")[0]
      const sameProvider = session.availableModels.find((m) => m.startsWith(lastProvider))
      if (sameProvider) return sameProvider
    }
    return session.availableModels[0]
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
