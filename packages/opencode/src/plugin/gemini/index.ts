import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { OAUTH_DUMMY_KEY } from "../../auth"
import { accessTokenExpired, isOAuthAuth, isFullOAuthAuth } from "./auth"
import { GEMINI_PROVIDER_ID } from "./constants"
import { authorizeGemini, exchangeGemini, exchangeGeminiWithVerifier, type GeminiTokenExchangeResult } from "./oauth"
import { ensureProjectContext } from "./project"
import { startGeminiDebugRequest } from "./debug"
import { isGenerativeLanguageRequest, prepareGeminiRequest, transformGeminiResponse } from "./request"
import { resolveCachedAuth } from "./cache"
import { startOAuthListener, type OAuthListener } from "./server"
import { refreshAccessToken } from "./token"
import type { OAuthAuthDetails } from "./types"

export async function GeminiAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: GEMINI_PROVIDER_ID,
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (!isOAuthAuth(auth)) {
          return {}
        }

        const providerOptions = provider?.options ?? undefined
        const projectIdFromConfig =
          providerOptions && typeof providerOptions.projectId === "string" ? providerOptions.projectId.trim() : ""
        const projectIdFromEnv = process.env.OPENCODE_GEMINI_PROJECT_ID?.trim() ?? ""
        const configuredProjectId = projectIdFromEnv || projectIdFromConfig || undefined

        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            if (model) {
              model.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } }
            }
          }
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            // Convert URL to string for consistency
            const requestUrl = requestInput instanceof URL ? requestInput.toString() : requestInput

            if (!isGenerativeLanguageRequest(requestUrl)) {
              return fetch(requestInput, init)
            }

            const latestAuth = await getAuth()
            if (!isOAuthAuth(latestAuth)) {
              return fetch(requestInput, init)
            }

            let authRecord = resolveCachedAuth(latestAuth)
            if (accessTokenExpired(authRecord)) {
              const refreshed = await refreshAccessToken(authRecord, input.client)
              if (!refreshed) {
                return fetch(requestInput, init)
              }
              authRecord = refreshed
            }

            // At this point authRecord should be a full OAuthAuthDetails with access token
            if (!isFullOAuthAuth(authRecord)) {
              return fetch(requestInput, init)
            }

            const accessToken = authRecord.access

            async function resolveProjectContext() {
              try {
                return await ensureProjectContext(authRecord as OAuthAuthDetails, input.client, configuredProjectId)
              } catch (error) {
                if (error instanceof Error) {
                  console.error(error.message)
                }
                throw error
              }
            }

            const projectContext = await resolveProjectContext()

            const { request, init: transformedInit, streaming, requestedModel } = prepareGeminiRequest(
              requestUrl,
              init,
              accessToken,
              projectContext.effectiveProjectId,
            )

            const originalUrl = toUrlString(requestUrl)
            const resolvedUrl = toUrlString(request)
            const debugContext = startGeminiDebugRequest({
              originalUrl,
              resolvedUrl,
              method: transformedInit.method,
              headers: transformedInit.headers,
              body: transformedInit.body,
              streaming,
              projectId: projectContext.effectiveProjectId,
            })

            const response = await fetch(request, transformedInit)
            return transformGeminiResponse(response, streaming, debugContext, requestedModel)
          },
        }
      },
      methods: [
        {
          label: "OAuth with Google (Gemini CLI)",
          type: "oauth",
          authorize: async () => {
            const isHeadless = Boolean(
              process.env.SSH_CONNECTION ||
                process.env.SSH_CLIENT ||
                process.env.SSH_TTY ||
                process.env.OPENCODE_HEADLESS,
            )

            let listener: OAuthListener | null = null
            if (!isHeadless) {
              try {
                listener = await startOAuthListener()
              } catch (error) {
                if (error instanceof Error) {
                  console.log(
                    `Warning: Couldn't start the local callback listener (${error.message}). You'll need to paste the callback URL or authorization code.`,
                  )
                } else {
                  console.log(
                    "Warning: Couldn't start the local callback listener. You'll need to paste the callback URL or authorization code.",
                  )
                }
              }
            } else {
              console.log("Headless environment detected. You'll need to paste the callback URL or authorization code.")
            }

            const authorization = await authorizeGemini()

            if (listener) {
              return {
                url: authorization.url,
                instructions:
                  "Complete the sign-in flow in your browser. We'll automatically detect the redirect back to localhost.",
                method: "auto",
                callback: async (): Promise<GeminiTokenExchangeResult> => {
                  try {
                    const callbackUrl = await listener.waitForCallback()
                    const code = callbackUrl.searchParams.get("code")
                    const state = callbackUrl.searchParams.get("state")

                    if (!code || !state) {
                      return {
                        type: "failed",
                        error: "Missing code or state in callback URL",
                      }
                    }

                    return await exchangeGemini(code, state)
                  } catch (error) {
                    return {
                      type: "failed",
                      error: error instanceof Error ? error.message : "Unknown error",
                    }
                  } finally {
                    try {
                      await listener?.close()
                    } catch {}
                  }
                },
              }
            }

            return {
              url: authorization.url,
              instructions:
                "Complete OAuth in your browser, then paste the full redirected URL (e.g., http://localhost:8085/oauth2callback?code=...&state=...) or just the authorization code.",
              method: "code",
              callback: async (callbackUrl: string): Promise<GeminiTokenExchangeResult> => {
                try {
                  const { code, state } = parseOAuthCallbackInput(callbackUrl)

                  if (!code) {
                    return {
                      type: "failed",
                      error: "Missing authorization code in callback input",
                    }
                  }

                  if (state) {
                    return exchangeGemini(code, state)
                  }

                  return exchangeGeminiWithVerifier(code, authorization.verifier)
                } catch (error) {
                  return {
                    type: "failed",
                    error: error instanceof Error ? error.message : "Unknown error",
                  }
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}

function toUrlString(value: RequestInfo): string {
  if (typeof value === "string") {
    return value
  }
  const candidate = (value as Request).url
  if (candidate) {
    return candidate
  }
  return value.toString()
}

function parseOAuthCallbackInput(input: string): { code?: string; state?: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    return {}
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return {
        code: url.searchParams.get("code") || undefined,
        state: url.searchParams.get("state") || undefined,
      }
    } catch {
      return {}
    }
  }

  const candidate = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed
  if (candidate.includes("=")) {
    const params = new URLSearchParams(candidate)
    const code = params.get("code") || undefined
    const state = params.get("state") || undefined
    if (code || state) {
      return { code, state }
    }
  }

  return { code: trimmed }
}
