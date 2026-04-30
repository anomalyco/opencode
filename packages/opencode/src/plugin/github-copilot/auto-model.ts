import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"

const log = Log.create({ service: "plugin.copilot.auto-model" })

type CopilotTokenEnvelope = {
  token: string
  endpoints?: {
    api?: string
    proxy?: string
    telemetry?: string
  }
  expires_at: number
}

type AutoSession = {
  available_models: string[]
  selected_model: string
  session_token: string
  expires_at: number
  discounted_costs?: Record<string, number>
}

const CAPI_HEADERS: Record<string, string> = {
  "X-GitHub-Api-Version": "2026-01-09",
  "Editor-Plugin-Version": "copilot-chat/0.27.0",
  "Editor-Version": "vscode/1.99.0",
  "Copilot-Integration-Id": "vscode-chat",
  "User-Agent": `opencode/${InstallationVersion}`,
  Accept: "application/json",
}

const TOKEN_REFRESH_MARGIN_MS = 60_000

export class AutoModelResolver {
  private copilotToken: CopilotTokenEnvelope | undefined
  private autoSession: AutoSession | undefined
  private inflightToken: Promise<CopilotTokenEnvelope> | undefined
  private inflightSession:
    | Promise<{ session: AutoSession; apiBaseUrl: string; authToken: string }>
    | undefined

  constructor(private oauthToken: string, private baseUrl: string) {}

  async resolve(): Promise<{ model: string; sessionToken: string; authToken: string; apiBaseUrl: string }> {
    const { session, apiBaseUrl, authToken } = await this.getAutoSession()
    const model = session.selected_model
    if (!model) throw new Error("Auto mode returned no selected model")
    return { model, sessionToken: session.session_token, authToken, apiBaseUrl }
  }

  private async getCopilotToken(): Promise<CopilotTokenEnvelope> {
    if (this.copilotToken && this.copilotToken.expires_at * 1000 > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return this.copilotToken
    }

    if (this.inflightToken) return this.inflightToken

    this.inflightToken = this.fetchCopilotToken().finally(() => {
      this.inflightToken = undefined
    })

    return this.inflightToken
  }

  private async getAutoSession(): Promise<{ session: AutoSession; apiBaseUrl: string; authToken: string }> {
    if (this.autoSession && this.autoSession.expires_at * 1000 > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      const copilotToken = await this.getCopilotToken()
      const apiBaseUrl = copilotToken.endpoints?.api?.replace(/\/+$/, "") ?? this.baseUrl
      return { session: this.autoSession, apiBaseUrl, authToken: copilotToken.token }
    }

    if (this.inflightSession) return this.inflightSession

    this.inflightSession = this.fetchAutoSession().finally(() => {
      this.inflightSession = undefined
    })

    return this.inflightSession
  }

  private async fetchCopilotToken(): Promise<CopilotTokenEnvelope> {
    const primary = await fetchCopilotTokenWithOauth(this.oauthToken).catch((err) => {
      log.debug("copilot_internal token exchange failed", { error: err })
      return undefined
    })
    if (primary) {
      this.copilotToken = primary
      log.info("copilot token obtained", { hasEndpoints: !!primary.endpoints })
      return primary
    }

    const fallback = await readFallbackOauthToken().catch((err) => {
      log.debug("failed to read fallback oauth token", { error: err })
      return undefined
    })

    if (!fallback || fallback === this.oauthToken) {
      throw new Error("copilot_internal/v2/token unavailable for this OAuth token")
    }

    const viaFallback = await fetchCopilotTokenWithOauth(fallback)
    this.copilotToken = viaFallback
    log.info("copilot token obtained via fallback oauth", { hasEndpoints: !!viaFallback.endpoints })
    return viaFallback
  }

  private async fetchAutoSession(): Promise<{ session: AutoSession; apiBaseUrl: string; authToken: string }> {
    const copilotToken = await this.getCopilotToken()
    const apiUrl = copilotToken.endpoints?.api?.replace(/\/+$/, "") ?? this.baseUrl

    const res = await fetch(`${apiUrl}/models/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${copilotToken.token}`,
        ...CAPI_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auto_mode: { model_hints: ["auto"] } }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`/models/session failed: ${res.status} ${text}`)
    }

    const data = (await res.json()) as AutoSession
    if (!Array.isArray(data.available_models) || data.available_models.length === 0) {
      throw new Error("/models/session returned no available models")
    }

    this.autoSession = data
    log.info("auto session obtained", { selected: data.selected_model, models: data.available_models.slice(0, 5) })
    return { session: data, apiBaseUrl: apiUrl, authToken: copilotToken.token }
  }
}

async function fetchCopilotTokenWithOauth(oauthToken: string): Promise<CopilotTokenEnvelope> {
  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${oauthToken}`,
      ...CAPI_HEADERS,
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`copilot_internal/v2/token failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as CopilotTokenEnvelope
  if (typeof data.token !== "string" || !data.token) {
    throw new Error("copilot_internal/v2/token missing token field")
  }

  return data
}

async function readFallbackOauthToken(): Promise<string | undefined> {
  const authFile = path.join(Global.Path.data, "auth.json")
  const json = (await Bun.file(authFile).json()) as Record<string, unknown>
  const info = json["copilot"]
  if (!isOauthInfo(info)) return undefined
  return info.refresh
}

function isOauthInfo(value: unknown): value is { type: "oauth"; refresh: string } {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.type !== "oauth") return false
  return typeof record.refresh === "string" && record.refresh.length > 0
}
