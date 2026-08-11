import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

const API_VERSION = "2026-06-01"
type CopilotEndpoint = "chat" | "responses" | "messages"

const sessions = new Map<
  string,
  {
    availableModels: string[]
    selectedModel: string
    sessionToken: string
    expiresAt: number
  }
>()

export function create(input: {
  sdk: {
    chat?: (modelID: string) => LanguageModelV3
    responses?: (modelID: string) => LanguageModelV3
    languageModel?: (modelID: string) => LanguageModelV3
  }
  baseURL: string
  fetch?: typeof fetch
  sessionID?: string
  endpoints?: Record<string, CopilotEndpoint>
}) {
  return new CopilotAutoLanguageModel(input)
}

class CopilotAutoLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly modelId = "auto"
  readonly provider = "github-copilot.auto"

  constructor(
    private readonly input: {
      sdk: {
        chat?: (modelID: string) => LanguageModelV3
        responses?: (modelID: string) => LanguageModelV3
        languageModel?: (modelID: string) => LanguageModelV3
      }
      baseURL: string
      fetch?: typeof fetch
      sessionID?: string
      endpoints?: Record<string, CopilotEndpoint>
    },
  ) {}

  get supportedUrls() {
    return {}
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const routed = await this.route(options)
    return routed.model.doGenerate({
      ...options,
      headers: {
        ...options.headers,
        "copilot-session-token": routed.sessionToken,
      },
    })
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const routed = await this.route(options)
    return routed.model.doStream({
      ...options,
      headers: {
        ...options.headers,
        "copilot-session-token": routed.sessionToken,
      },
    })
  }

  private async route(options: LanguageModelV3CallOptions) {
    const session = await this.session(options.abortSignal)
    const prompt = promptText(options.prompt)
    const response = await this.fetch(`${this.input.baseURL}/models/session/intent`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "copilot-session-token": session.sessionToken,
      },
      body: JSON.stringify({
        prompt,
        available_models: session.availableModels,
        session_id: `opencode-session://${this.input.sessionID ?? "auto"}`,
        reference_count: 0,
        prompt_char_count: prompt.length,
        turn_number: options.prompt.filter((message) => message.role === "user").length,
        routing_method: "hydra",
        copilot_plan: "individual",
      }),
      signal: options.abortSignal ?? AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`Failed to route Copilot auto model: ${response.status}`)
    const intent = (await response.json()) as { chosen_model?: string }
    const modelID = intent.chosen_model ?? session.selectedModel
    return {
      sessionToken: session.sessionToken,
      model: this.model(modelID),
    }
  }

  private async session(signal?: AbortSignal) {
    const key = `${this.input.sessionID ?? "auto"}:${this.input.baseURL}`
    const cached = sessions.get(key)
    if (cached && cached.expiresAt > Math.floor(Date.now() / 1000) + 30) return cached

    const response = await this.fetch(`${this.input.baseURL}/models/session`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ auto_mode: { model_hints: ["auto"] } }),
      signal: signal ?? AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`Failed to create Copilot auto session: ${response.status}`)
    const data = (await response.json()) as {
      available_models: string[]
      selected_model: string
      session_token: string
      expires_at: number
    }
    const next = {
      availableModels: data.available_models,
      selectedModel: data.selected_model,
      sessionToken: data.session_token,
      expiresAt: data.expires_at,
    }
    sessions.set(key, next)
    return next
  }

  private model(modelID: string) {
    const endpoint = this.input.endpoints?.[modelID]
    if (endpoint === "responses" && this.input.sdk.responses) return this.input.sdk.responses(modelID)
    if (endpoint === "chat" && this.input.sdk.chat) return this.input.sdk.chat(modelID)

    const match = /^gpt-(\d+)/.exec(modelID)
    if (match && Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")) {
      return (
        this.input.sdk.responses?.(modelID) ?? this.input.sdk.languageModel?.(modelID) ?? this.input.sdk.chat!(modelID)
      )
    }
    return (
      this.input.sdk.chat?.(modelID) ?? this.input.sdk.languageModel?.(modelID) ?? this.input.sdk.responses!(modelID)
    )
  }

  private headers() {
    return {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": `opencode/${InstallationVersion}`,
      "X-GitHub-Api-Version": API_VERSION,
    }
  }

  private fetch(input: string, init: RequestInit) {
    return (this.input.fetch ?? fetch)(input, init)
  }
}

function promptText(prompt: LanguageModelV3CallOptions["prompt"]) {
  const message = prompt.findLast((message) => message.role === "user")
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  if (!Array.isArray(message.content)) return ""
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
}

export * as CopilotAuto from "./auto"
