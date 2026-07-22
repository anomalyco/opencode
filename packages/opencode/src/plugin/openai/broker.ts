import { OpenAIWebSocketPool } from "./ws-pool"

const REFRESH_WINDOW_MS = 5 * 60 * 1000

export interface BrokerOptions {
  url: string
  serviceTokenFile: string
  codexApiEndpoint: string
  fetch: typeof fetch
  websocketFetch?: ReturnType<typeof OpenAIWebSocketPool.createWebSocketFetch>
}

interface BrokerToken {
  accessToken: string
  accessTokenHash: string
  chatgptAccountId: string
  chatgptPlanType?: string
  expiresAt: string
}

export function createBrokerFetch(options: BrokerOptions) {
  let current: BrokerToken | undefined
  let pending: Promise<BrokerToken> | undefined

  const token = async (previousHash = "") => {
    if (previousHash && current && current.accessTokenHash !== previousHash) return current
    if (!previousHash && current && Date.parse(current.expiresAt) > Date.now() + REFRESH_WINDOW_MS) return current
    if (pending) return pending

    pending = requestToken(options, previousHash)
      .then((result) => {
        current = result
        return result
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  const send = async (requestInput: RequestInfo | URL, init: RequestInit | undefined, auth: BrokerToken) => {
    const headers = new Headers(init?.headers)
    headers.delete("authorization")
    headers.set("authorization", `Bearer ${auth.accessToken}`)
    headers.set("ChatGPT-Account-Id", auth.chatgptAccountId)

    const parsed =
      requestInput instanceof URL
        ? requestInput
        : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
    const url =
      parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
        ? new URL(options.codexApiEndpoint)
        : parsed
    const requestInit = { ...init, headers }
    if (options.websocketFetch && parsed.pathname.endsWith("/responses")) {
      return options.websocketFetch(url, requestInit)
    }
    return options.fetch(url, OpenAIWebSocketPool.withoutInternalHeaders(requestInit))
  }

  return async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const initial = await token()
    const response = await send(requestInput, init, initial)
    if (response.status !== 401) return response

    await response.body?.cancel()
    return send(requestInput, init, await token(initial.accessTokenHash))
  }
}

async function requestToken(options: BrokerOptions, previousHash: string) {
  const serviceToken = (await Bun.file(options.serviceTokenFile).text()).trim()
  if (!serviceToken) throw new Error("OpenAI auth broker service token is empty")

  const response = await options.fetch(options.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ previousAccessTokenHash: previousHash }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`OpenAI auth broker returned HTTP ${response.status}`)

  const token: unknown = await response.json()
  if (
    typeof token !== "object" ||
    token === null ||
    !("accessToken" in token) ||
    typeof token.accessToken !== "string" ||
    !("accessTokenHash" in token) ||
    typeof token.accessTokenHash !== "string" ||
    !("chatgptAccountId" in token) ||
    typeof token.chatgptAccountId !== "string" ||
    !("expiresAt" in token) ||
    typeof token.expiresAt !== "string" ||
    !token.accessToken ||
    !token.accessTokenHash ||
    !token.chatgptAccountId ||
    !token.expiresAt ||
    !Number.isFinite(Date.parse(token.expiresAt))
  ) {
    throw new Error("OpenAI auth broker returned an incomplete token")
  }
  return {
    accessToken: token.accessToken,
    accessTokenHash: token.accessTokenHash,
    chatgptAccountId: token.chatgptAccountId,
    ...("chatgptPlanType" in token && typeof token.chatgptPlanType === "string"
      ? { chatgptPlanType: token.chatgptPlanType }
      : {}),
    expiresAt: token.expiresAt,
  }
}
