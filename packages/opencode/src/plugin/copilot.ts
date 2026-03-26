import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Installation } from "@/installation"
import { iife } from "@/util/iife"
import { Lock } from "@/util/lock"
import { setTimeout as sleep } from "node:timers/promises"

const CLIENT_ID = "Iv1.b507a08c87ecfe98"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
const COPILOT_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

function normalizeDomain(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function getUrls(domain: string) {
  return {
    DEVICE_CODE_URL: `https://${domain}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${domain}/login/oauth/access_token`,
  }
}

async function refreshGitHubAccessToken(
  refreshToken: string,
  enterpriseUrl?: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com"
  const response = await fetch(`https://${domain}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `opencode/${Installation.VERSION}`,
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })
  if (!response.ok) {
    throw new Error(`GitHub token refresh failed: ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
  }
  if (data.error || !data.access_token) {
    throw new Error(`GitHub token refresh failed: ${data.error ?? "no access_token"}`)
  }
  return data as { access_token: string; refresh_token?: string; expires_in?: number }
}

async function exchangeCopilotSessionToken(
  githubToken: string,
  enterpriseUrl?: string,
): Promise<{ token: string; expires_at: number }> {
  const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com"
  const response = await fetch(`https://api.${domain}/copilot_internal/v2/token`, {
    headers: {
      Accept: "application/json",
      Authorization: `token ${githubToken}`,
      "User-Agent": `opencode/${Installation.VERSION}`,
      "Editor-Version": "vscode/1.107.0",
      "Editor-Plugin-Version": "copilot-chat/0.35.0",
      "Copilot-Integration-Id": "vscode-chat",
    },
  })
  if (!response.ok) {
    throw new Error(`Copilot token exchange failed: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<{ token: string; expires_at: number }>
}

export async function CopilotAuthPlugin(input: PluginInput): Promise<Hooks> {
  const sdk = input.client
  return {
    auth: {
      provider: "github-copilot",
      async loader(getAuth, provider) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}

        const enterpriseUrl = info.enterpriseUrl
        const baseURL = enterpriseUrl ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}` : undefined

        if (provider && provider.models) {
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            }

            // TODO: re-enable once messages api has higher rate limits
            // TODO: move some of this hacky-ness to models.dev presets once we have better grasp of things here...
            // const base = baseURL ?? model.api.url
            // const claude = model.id.includes("claude")
            // const url = iife(() => {
            //   if (!claude) return base
            //   if (base.endsWith("/v1")) return base
            //   if (base.endsWith("/")) return `${base}v1`
            //   return `${base}/v1`
            // })

            // model.api.url = url
            // model.api.npm = claude ? "@ai-sdk/anthropic" : "@ai-sdk/github-copilot"
            model.api.npm = "@ai-sdk/github-copilot"
          }
        }

        return {
          baseURL,
          apiKey: "",
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(request, init)

            const saveAuth = (auth: typeof currentAuth, refresh: string, access: string, expires: number) =>
              sdk.auth.set({
                path: { id: "github-copilot" },
                body: {
                  type: "oauth",
                  refresh,
                  access,
                  expires,
                  ...(auth.enterpriseUrl && { enterpriseUrl: auth.enterpriseUrl }),
                },
              })

            const isLegacy = currentAuth.refresh.startsWith("gho_")
            let sessionToken = currentAuth.access
            if (!isLegacy && (!sessionToken?.startsWith("tid=") || currentAuth.expires < Date.now())) {
              using _ = await Lock.write(`github-copilot:${currentAuth.enterpriseUrl ?? "github.com"}`)

              const auth = await getAuth()
              if (auth.type !== "oauth") return fetch(request, init)

              const fresh = auth.access?.startsWith("tid=") && auth.expires >= Date.now()
              if (fresh) {
                sessionToken = auth.access
              } else {
                const isRawToken = auth.refresh.startsWith("ghu_") || auth.refresh.startsWith("gho_")
                try {
                  let githubToken = auth.refresh
                  let newRefresh = auth.refresh
                  if (!isRawToken) {
                    const refreshed = await refreshGitHubAccessToken(githubToken, auth.enterpriseUrl)
                    githubToken = refreshed.access_token
                    newRefresh = refreshed.refresh_token || auth.refresh
                    await saveAuth(auth, newRefresh, auth.access, 0)
                  }

                  const exchanged = await exchangeCopilotSessionToken(githubToken, auth.enterpriseUrl)
                  sessionToken = exchanged.token
                  await saveAuth(auth, newRefresh, exchanged.token, exchanged.expires_at * 1000 - COPILOT_TOKEN_REFRESH_MARGIN_MS)
                } catch {
                  sessionToken = isRawToken ? auth.refresh : auth.access || auth.refresh
                }
              }
            }

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
                    isAgent: last?.role !== "user",
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
                    isAgent: last?.role !== "user",
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
                    isAgent: !(last?.role === "user" && hasNonToolCalls),
                  }
                }
              } catch {}
              return { isVision: false, isAgent: false }
            })

            const headers: Record<string, string> = {
              "x-initiator": isAgent ? "agent" : "user",
              ...(init?.headers as Record<string, string>),
              "User-Agent": `opencode/${Installation.VERSION}`,
              Authorization: `Bearer ${sessionToken}`,
              "Openai-Intent": "conversation-edits",
              "Editor-Version": "vscode/1.107.0",
              "Editor-Plugin-Version": "copilot-chat/0.35.0",
              "Copilot-Integration-Id": "vscode-chat",
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
                    refresh_token?: string
                    expires_in?: number
                    error?: string
                    interval?: number
                  }

                  if (data.access_token) {
                    return {
                      type: "success" as const,
                      refresh: data.refresh_token || data.access_token,
                      access: data.access_token,
                      expires: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
                      ...(deploymentType === "enterprise" && { enterpriseUrl: domain }),
                    }
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

      if (parts?.data.parts?.some((part) => part.type === "compaction")) {
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
