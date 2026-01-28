import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Installation } from "@/installation"
import { iife } from "@/util/iife"

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

            // TODO: move some of this hacky-ness to models.dev presets once we have better grasp of things here...
            const base = baseURL ?? model.api.url
            const claude = model.id.includes("claude")
            const url = iife(() => {
              if (!claude) return base
              if (base.endsWith("/v1")) return base
              if (base.endsWith("/")) return `${base}v1`
              return `${base}/v1`
            })

            model.api.url = url
            model.api.npm = claude ? "@ai-sdk/anthropic" : "@ai-sdk/github-copilot"
          }
        }

        return {
          apiKey: "",
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const info = await getAuth()
            if (info.type !== "oauth") return fetch(request, init)

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
              Authorization: `Bearer ${info.refresh}`,
              "Openai-Intent": "conversation-edits",
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
              condition: (inputs) => inputs.deploymentType === "enterprise",
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
            let actualProvider = "github-copilot"

            if (deploymentType === "enterprise") {
              const enterpriseUrl = inputs.enterpriseUrl
              domain = normalizeDomain(enterpriseUrl!)
              actualProvider = "github-copilot-enterprise"
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

                    if (actualProvider === "github-copilot-enterprise") {
                      result.provider = "github-copilot-enterprise"
                      result.enterpriseUrl = domain
                    }

                    return result
                  }

                  if (data.error === "authorization_pending") {
                    await Bun.sleep(deviceData.interval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS)
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

                    await Bun.sleep(newInterval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                    continue
                  }

                  if (data.error) return { type: "failed" as const }

                  await Bun.sleep(deviceData.interval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS)
                  continue
                }
              },
            }
          },
        },
      ],
    },
    "chat.headers": async (input, output) => {
      if (!input.model.providerID.includes("github-copilot")) return

      if (input.model.api.npm === "@ai-sdk/anthropic") {
        output.headers["anthropic-beta"] = "interleaved-thinking-2025-05-14"
      }

      const session = await sdk.session
        .get({
          path: {
            id: input.sessionID,
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
