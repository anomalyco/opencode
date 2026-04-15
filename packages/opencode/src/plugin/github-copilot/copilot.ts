import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk/v2"
import { Installation } from "@/installation"
import { iife } from "@/util/iife"
import { Log } from "../../util/log"
import { setTimeout as sleep } from "node:timers/promises"
import { CopilotModels } from "./models"
import { MessageV2 } from "@/session/message-v2"

const log = Log.create({ service: "plugin.copilot" })

const CLIENT_ID = "Ov23li8tweQw6odWQebz"
// Add a small safety buffer when polling to avoid hitting the server
// slightly too early due to clock skew / timer drift.
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000 // 3 seconds
function normalizeDomain(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function getUrls(domain: string) {
  return {
    DEVICE_CODE_URL: `https://${domain}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${domain}/login/oauth/access_token`,
  }
}

const DEFAULT_COPILOT_API_URL = "https://api.githubcopilot.com"

/**
 * Detect whether an OAuth token is a GitHub App token (ghu_ prefix, issued by
 * VS Code's client ID) vs an OAuth App token (gho_ prefix, issued by OpenCode's
 * own client ID). ghu_ tokens require VS Code identity spoofing + bearer token
 * exchange to work with the Copilot Business/Enterprise API.
 */
function isGhuToken(token: string): boolean {
  return token.startsWith("ghu_")
}

/**
 * VS Code identity headers. Required when using a ghu_ token (issued by VS
 * Code's client ID Iv1.b507a08c87ecfe98). The Copilot API gates model access
 * per OAuth client ID, and ghu_ tokens are bound to VS Code's client. Requests
 * using these tokens must present matching identity headers or the API returns
 * HTTP 400 "model not supported".
 *
 * Every third-party tool that works with Copilot Business (copilot.vim,
 * avante.nvim, LiteLLM) sends these exact headers.
 */
const VSCODE_IDENTITY_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
}

/**
 * Cache for the token exchange response from `copilot_internal/v2/token`.
 * Stores both the API endpoint and the short-lived bearer token. The raw ghu_
 * token cannot be used directly as Authorization — it must be exchanged for an
 * HMAC-signed bearer token that the Copilot API actually accepts.
 *
 * Keyed by OAuth token prefix to support multiple accounts.
 */
let copilotTokenCache:
  | {
      tokenPrefix: string
      apiEndpoint: string
      bearerToken: string
      expiresAt: number
    }
  | undefined

/**
 * Exchange the OAuth token via `copilot_internal/v2/token` and cache both the
 * plan-specific API endpoint and the short-lived bearer token.
 *
 * GitHub returns plan-specific endpoints (e.g. `api.business.githubcopilot.com`
 * for Business users). The legacy unified endpoint `api.githubcopilot.com` is
 * being deprecated (HTTP 466).
 *
 * For ghu_ tokens, the returned bearer token is mandatory — the Copilot API
 * does not accept raw ghu_ tokens. For gho_ tokens, the raw token can be used
 * directly but the endpoint discovery is still needed.
 *
 * The result is cached until the token's `expires_at` timestamp minus a 2-minute
 * buffer to ensure refresh happens before expiry.
 */
async function exchangeCopilotToken(oauthToken: string, enterpriseDomain?: string): Promise<{
  apiEndpoint: string
  bearerToken: string
}> {
  // Enterprise Server users have their own endpoint pattern
  if (enterpriseDomain) {
    return {
      apiEndpoint: `https://copilot-api.${normalizeDomain(enterpriseDomain)}`,
      bearerToken: oauthToken,
    }
  }

  // Return cached result if still valid (with 2-minute early refresh buffer)
  const prefix = oauthToken.slice(0, 8)
  const REFRESH_BUFFER_MS = 2 * 60 * 1000
  if (
    copilotTokenCache &&
    copilotTokenCache.tokenPrefix === prefix &&
    Date.now() < copilotTokenCache.expiresAt - REFRESH_BUFFER_MS
  ) {
    return {
      apiEndpoint: copilotTokenCache.apiEndpoint,
      bearerToken: copilotTokenCache.bearerToken,
    }
  }

  // Use VS Code identity headers for ghu_ tokens, OpenCode identity for gho_
  const userAgent = isGhuToken(oauthToken) ? VSCODE_IDENTITY_HEADERS["User-Agent"] : `opencode/${Installation.VERSION}`
  const exchangeHeaders: Record<string, string> = {
    Authorization: `token ${oauthToken}`,
    Accept: "application/json",
    "User-Agent": userAgent,
  }
  if (isGhuToken(oauthToken)) {
    exchangeHeaders["Editor-Version"] = VSCODE_IDENTITY_HEADERS["Editor-Version"]
    exchangeHeaders["Editor-Plugin-Version"] = VSCODE_IDENTITY_HEADERS["Editor-Plugin-Version"]
    exchangeHeaders["Copilot-Integration-Id"] = VSCODE_IDENTITY_HEADERS["Copilot-Integration-Id"]
  }

  try {
    const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: exchangeHeaders,
      signal: AbortSignal.timeout(5_000),
    })

    if (response.ok) {
      const data = (await response.json()) as {
        token: string
        expires_at?: number
        endpoints?: {
          api?: string
          proxy?: string
          telemetry?: string
          "origin-tracker"?: string
        }
      }

      const apiEndpoint = data.endpoints?.api || DEFAULT_COPILOT_API_URL
      const bearerToken = data.token || oauthToken
      const expiresAt = data.expires_at ? data.expires_at * 1000 : Date.now() + 25 * 60 * 1000

      copilotTokenCache = {
        tokenPrefix: prefix,
        apiEndpoint,
        bearerToken,
        expiresAt,
      }

      log.info("copilot token exchange succeeded", {
        endpoint: apiEndpoint,
        tokenType: isGhuToken(oauthToken) ? "ghu" : "gho",
        expiresIn: Math.round((expiresAt - Date.now()) / 1000) + "s",
      })

      return { apiEndpoint, bearerToken }
    } else {
      log.warn("copilot token exchange failed", {
        status: response.status,
        statusText: response.statusText,
      })
    }
  } catch (error) {
    log.warn("failed to exchange copilot token, using defaults", { error })
  }

  // Fallback: use raw token and default endpoint
  return {
    apiEndpoint: DEFAULT_COPILOT_API_URL,
    bearerToken: oauthToken,
  }
}

/**
 * Legacy wrapper for backward compatibility — returns just the API endpoint.
 */
async function getCopilotApiEndpoint(oauthToken: string, enterpriseDomain?: string): Promise<string> {
  const result = await exchangeCopilotToken(oauthToken, enterpriseDomain)
  return result.apiEndpoint
}

/**
 * Get the correct bearer token for API calls. For ghu_ tokens, this returns the
 * exchanged short-lived bearer. For gho_ tokens, returns the raw token.
 */
async function getCopilotBearerToken(oauthToken: string, enterpriseDomain?: string): Promise<string> {
  const result = await exchangeCopilotToken(oauthToken, enterpriseDomain)
  return result.bearerToken
}

function base(enterpriseUrl?: string) {
  return enterpriseUrl ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}` : DEFAULT_COPILOT_API_URL
}

// Check if a message is a synthetic user msg used to attach an image from a tool call
function imgMsg(msg: any): boolean {
  if (msg?.role !== "user") return false

  // Handle the 3 api formats

  const content = msg.content
  if (typeof content === "string") return content === MessageV2.SYNTHETIC_ATTACHMENT_PROMPT
  if (!Array.isArray(content)) return false
  return content.some(
    (part: any) =>
      (part?.type === "text" || part?.type === "input_text") && part.text === MessageV2.SYNTHETIC_ATTACHMENT_PROMPT,
  )
}

function fix(model: Model, url: string): Model {
  return {
    ...model,
    api: {
      ...model.api,
      url,
      npm: "@ai-sdk/github-copilot",
    },
  }
}

export async function CopilotAuthPlugin(input: PluginInput): Promise<Hooks> {
  const sdk = input.client
  return {
    provider: {
      id: "github-copilot",
      async models(provider, ctx) {
        if (ctx.auth?.type !== "oauth") {
          return Object.fromEntries(Object.entries(provider.models).map(([id, model]) => [id, fix(model, base())]))
        }

        const auth = ctx.auth
        const { apiEndpoint, bearerToken } = await exchangeCopilotToken(auth.refresh, auth.enterpriseUrl)
        const modelHeaders: Record<string, string> = {
          Authorization: `Bearer ${bearerToken}`,
          "User-Agent": isGhuToken(auth.refresh)
            ? VSCODE_IDENTITY_HEADERS["User-Agent"]
            : `opencode/${Installation.VERSION}`,
        }
        if (isGhuToken(auth.refresh)) {
          modelHeaders["Editor-Version"] = VSCODE_IDENTITY_HEADERS["Editor-Version"]
          modelHeaders["Editor-Plugin-Version"] = VSCODE_IDENTITY_HEADERS["Editor-Plugin-Version"]
          modelHeaders["Copilot-Integration-Id"] = VSCODE_IDENTITY_HEADERS["Copilot-Integration-Id"]
        }
        return CopilotModels.get(
          apiEndpoint,
          modelHeaders,
          provider.models,
        ).catch((error) => {
          log.error("failed to fetch copilot models", { error })
          return Object.fromEntries(
            Object.entries(provider.models).map(([id, model]) => [id, fix(model, apiEndpoint)]),
          )
        })
      },
    },
    auth: {
      provider: "github-copilot",
      async loader(getAuth) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}


        return {
          apiKey: "",
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const info = await getAuth()
            if (info.type !== "oauth") return fetch(request, init)

            // Exchange token on every fetch to ensure we have a fresh bearer
            const { bearerToken } = await exchangeCopilotToken(info.refresh, info.enterpriseUrl)
            const useVscodeIdentity = isGhuToken(info.refresh)

            const url = request instanceof URL ? request.href : request.toString()
            const { isVision, isAgent } = iife(() => {
              try {
                const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body

                // Completions API
                if (body?.messages && url.includes("completions")) {
                  const last = body.messages[body.messages.length - 1]
                  return {
                    isVision: body.messages.some(
                      (msg: any) =>
                        Array.isArray(msg.content) && msg.content.some((part: any) => part.type === "image_url"),
                    ),
                    isAgent: last?.role !== "user" || imgMsg(last),
                  }
                }

                // Responses API
                if (body?.input) {
                  const last = body.input[body.input.length - 1]
                  return {
                    isVision: body.input.some(
                      (item: any) =>
                        Array.isArray(item?.content) && item.content.some((part: any) => part.type === "input_image"),
                    ),
                    isAgent: last?.role !== "user" || imgMsg(last),
                  }
                }

                // Messages API
                if (body?.messages) {
                  const last = body.messages[body.messages.length - 1]
                  const hasNonToolCalls =
                    Array.isArray(last?.content) && last.content.some((part: any) => part?.type !== "tool_result")
                  return {
                    isVision: body.messages.some(
                      (item: any) =>
                        Array.isArray(item?.content) &&
                        item.content.some(
                          (part: any) =>
                            part?.type === "image" ||
                            // images can be nested inside tool_result content
                            (part?.type === "tool_result" &&
                              Array.isArray(part?.content) &&
                              part.content.some((nested: any) => nested?.type === "image")),
                        ),
                    ),
                    isAgent: !(last?.role === "user" && hasNonToolCalls) || imgMsg(last),
                  }
                }
              } catch {}
              return { isVision: false, isAgent: false }
            })

            const headers: Record<string, string> = {
              "x-initiator": isAgent ? "agent" : "user",
              ...(init?.headers as Record<string, string>),
              "User-Agent": useVscodeIdentity
                ? VSCODE_IDENTITY_HEADERS["User-Agent"]
                : `opencode/${Installation.VERSION}`,
              Authorization: `Bearer ${bearerToken}`,
              "Openai-Intent": "conversation-edits",
            }

            if (useVscodeIdentity) {
              headers["Editor-Version"] = VSCODE_IDENTITY_HEADERS["Editor-Version"]
              headers["Editor-Plugin-Version"] = VSCODE_IDENTITY_HEADERS["Editor-Plugin-Version"]
              headers["Copilot-Integration-Id"] = VSCODE_IDENTITY_HEADERS["Copilot-Integration-Id"]
            }

            if (isVision) {
              headers["Copilot-Vision-Request"] = "true"
            }

            delete headers["x-api-key"]
            delete headers["authorization"]

            return fetch(request, {
              ...init,
              headers,
            })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Login with GitHub Copilot",
          prompts: [
            {
              type: "select",
              key: "deploymentType",
              message: "Select GitHub deployment type",
              options: [
                {
                  label: "GitHub.com",
                  value: "github.com",
                  hint: "Public",
                },
                {
                  label: "GitHub Enterprise",
                  value: "enterprise",
                  hint: "Data residency or self-hosted",
                },
              ],
            },
            {
              type: "text",
              key: "enterpriseUrl",
              message: "Enter your GitHub Enterprise URL or domain",
              placeholder: "company.ghe.com or https://company.ghe.com",
              when: { key: "deploymentType", op: "eq", value: "enterprise" },
              validate: (value) => {
                if (!value) return "URL or domain is required"
                try {
                  const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`)
                  if (!url.hostname) return "Please enter a valid URL or domain"
                  return undefined
                } catch {
                  return "Please enter a valid URL (e.g., company.ghe.com or https://company.ghe.com)"
                }
              },
            },
          ],
          async authorize(inputs = {}) {
            const deploymentType = inputs.deploymentType || "github.com"

            let domain = "github.com"

            if (deploymentType === "enterprise") {
              const enterpriseUrl = inputs.enterpriseUrl
              domain = normalizeDomain(enterpriseUrl!)
            }

            const urls = getUrls(domain)

            const deviceResponse = await fetch(urls.DEVICE_CODE_URL, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "User-Agent": `opencode/${Installation.VERSION}`,
              },
              body: JSON.stringify({
                client_id: CLIENT_ID,
                scope: "read:user",
              }),
            })

            if (!deviceResponse.ok) {
              throw new Error("Failed to initiate device authorization")
            }

            const deviceData = (await deviceResponse.json()) as {
              verification_uri: string
              user_code: string
              device_code: string
              interval: number
            }

            return {
              url: deviceData.verification_uri,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  const response = await fetch(urls.ACCESS_TOKEN_URL, {
                    method: "POST",
                    headers: {
                      Accept: "application/json",
                      "Content-Type": "application/json",
                      "User-Agent": `opencode/${Installation.VERSION}`,
                    },
                    body: JSON.stringify({
                      client_id: CLIENT_ID,
                      device_code: deviceData.device_code,
                      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    }),
                  })

                  if (!response.ok) return { type: "failed" as const }

                  const data = (await response.json()) as {
                    access_token?: string
                    error?: string
                    interval?: number
                  }

                  if (data.access_token) {
                    const result: {
                      type: "success"
                      refresh: string
                      access: string
                      expires: number
                      provider?: string
                      enterpriseUrl?: string
                    } = {
                      type: "success",
                      refresh: data.access_token,
                      access: data.access_token,
                      expires: 0,
                    }

                    if (deploymentType === "enterprise") {
                      result.enterpriseUrl = domain
                    }

                    return result
                  }

                  if (data.error === "authorization_pending") {
                    await sleep(deviceData.interval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS)
                    continue
                  }

                  if (data.error === "slow_down") {
                    // Based on the RFC spec, we must add 5 seconds to our current polling interval.
                    // (See https://www.rfc-editor.org/rfc/rfc8628#section-3.5)
                    let newInterval = (deviceData.interval + 5) * 1000

                    // GitHub OAuth API may return the new interval in seconds in the response.
                    // We should try to use that if provided with safety margin.
                    const serverInterval = data.interval
                    if (serverInterval && typeof serverInterval === "number" && serverInterval > 0) {
                      newInterval = serverInterval * 1000
                    }

                    await sleep(newInterval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                    continue
                  }

                  if (data.error) return { type: "failed" as const }

                  await sleep(deviceData.interval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS)
                  continue
                }
              },
            }
          },
        },
      ],
    },
    "chat.params": async (incoming, output) => {
      if (!incoming.model.providerID.includes("github-copilot")) return

      // Match github copilot cli, omit maxOutputTokens for gpt models
      if (incoming.model.api.id.includes("gpt")) {
        output.maxOutputTokens = undefined
      }
    },
    "chat.headers": async (incoming, output) => {
      if (!incoming.model.providerID.includes("github-copilot")) return

      if (incoming.model.api.npm === "@ai-sdk/anthropic") {
        output.headers["anthropic-beta"] = "interleaved-thinking-2025-05-14"
      }

      const parts = await sdk.session
        .message({
          path: {
            id: incoming.message.sessionID,
            messageID: incoming.message.id,
          },
          query: {
            directory: input.directory,
          },
          throwOnError: true,
        })
        .catch(() => undefined)

      if (
        parts?.data.parts?.some(
          (part) =>
            part.type === "compaction" ||
            // Auto-compaction resumes via a synthetic user text part. Treat only
            // that marked followup as agent-initiated so manual prompts stay user-initiated.
            (part.type === "text" && part.synthetic && part.metadata?.compaction_continue === true),
        )
      ) {
        output.headers["x-initiator"] = "agent"
        return
      }

      const session = await sdk.session
        .get({
          path: {
            id: incoming.sessionID,
          },
          query: {
            directory: input.directory,
          },
          throwOnError: true,
        })
        .catch(() => undefined)
      if (!session || !session.data.parentID) return
      // mark subagent sessions as agent initiated matching standard that other copilot tools have
      output.headers["x-initiator"] = "agent"
    },
  }
}
