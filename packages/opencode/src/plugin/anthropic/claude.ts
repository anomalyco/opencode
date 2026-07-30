import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk/v2"
import { Global } from "@opencode-ai/core/global"
import { OauthCallbackPage } from "@opencode-ai/core/oauth/page"
import { Flock } from "@opencode-ai/core/util/flock"
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { createServer, type ServerResponse } from "node:http"
import path from "node:path"
import { OAUTH_DUMMY_KEY } from "../../auth"
import { isRecord } from "@/util/record"

export const CLAUDE_CODE_VERSION = "2.1.220"
export const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
export const AUTHORIZE_ENDPOINT = "https://claude.com/cai/oauth/authorize"
export const TOKEN_ENDPOINT = "https://platform.claude.com/v1/oauth/token"
export const PROFILE_ENDPOINT = "https://api.anthropic.com/api/oauth/profile"
export const API_ENDPOINT = "https://api.anthropic.com/v1/messages"
export const SUCCESS_ENDPOINT = "https://platform.claude.com/oauth/code/success?app=claude-code"
export const REFRESH_SCOPES = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
] as const
export const AUTHORIZE_SCOPES = ["org:create_api_key", ...REFRESH_SCOPES] as const
export const SUBSCRIPTION_MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-opus-4-8", "claude-fable-5"] as const
export const ANTHROPIC_VERSION = "2023-06-01"
export const CLAUDE_CODE_BILLING =
  "x-anthropic-billing-header: cc_version=2.1.220.205; cc_entrypoint=sdk-cli; cch=00000;"
export const CLAUDE_CODE_AUXILIARY_BILLING =
  "x-anthropic-billing-header: cc_version=2.1.220.aa8; cc_entrypoint=sdk-cli; cch=00000;"
export const CLAUDE_AGENT_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK."
export const ANTHROPIC_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "mid-conversation-system-2026-04-07",
  "advisor-tool-2026-03-01",
  "effort-2025-11-24",
  "extended-cache-ttl-2025-04-11",
  "cache-diagnosis-2026-04-07",
].join(",")
export const ANTHROPIC_AUXILIARY_BETA = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "advisor-tool-2026-03-01",
  "structured-outputs-2025-12-15",
  "cache-diagnosis-2026-04-07",
].join(",")

const USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`
const REFRESH_WINDOW_MS = 5 * 60 * 1000
const TOKEN_TIMEOUT_MS = 30 * 1000
const PROFILE_TIMEOUT_MS = 10 * 1000
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000
const STAINLESS_PACKAGE_VERSION = "0.94.0"
const STAINLESS_RUNTIME_VERSION = "v26.3.0"
const UTILITY_MODELS = ["claude-haiku-4-5-20251001", "claude-haiku-4-5"]
const DEVICE_ID_PATTERN = /^[0-9a-f]{64}$/
const DEVICE_ID_FILE = path.join(Global.Path.data, "anthropic-device-id")

export interface PkceCodes {
  verifier: string
  challenge: string
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  refresh_token_expires_in?: number
  scope?: string
}

export interface ClaudeAuthPluginOptions {
  authorizeEndpoint?: string
  tokenEndpoint?: string
  profileEndpoint?: string
  apiEndpoint?: string
  httpFetch?: typeof fetch
  now?: () => number
  deviceID?: () => Promise<string>
}

interface OAuthCallback {
  redirectUri: string
  code: Promise<string>
  complete: () => void
  cancel: (error: Error) => void
}

function base64UrlEncode(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url")
}

function stainlessOS() {
  if (process.platform === "darwin") return "MacOS"
  if (process.platform === "win32") return "Windows"
  if (process.platform === "linux") return "Linux"
  return `Other:${process.platform}`
}

export async function generatePKCE(): Promise<PkceCodes> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  )
  return { verifier, challenge }
}

export function buildAuthorizeUrl(input: { redirectUri: string; challenge: string; state: string; endpoint?: string }) {
  const url = new URL(input.endpoint ?? AUTHORIZE_ENDPOINT)
  url.search = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: AUTHORIZE_SCOPES.join(" "),
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
  }).toString()
  return url.toString()
}

export async function exchangeAuthorizationCode(input: {
  code: string
  redirectUri: string
  verifier: string
  state: string
  endpoint?: string
  httpFetch?: typeof fetch
}) {
  return requestTokens({
    operation: "exchange",
    endpoint: input.endpoint ?? TOKEN_ENDPOINT,
    httpFetch: input.httpFetch ?? fetch,
    requireRefresh: true,
    body: {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: input.verifier,
      state: input.state,
    },
  })
}

export async function refreshAccessToken(input: { refresh: string; endpoint?: string; httpFetch?: typeof fetch }) {
  return requestTokens({
    operation: "refresh",
    endpoint: input.endpoint ?? TOKEN_ENDPOINT,
    httpFetch: input.httpFetch ?? fetch,
    requireRefresh: false,
    body: {
      grant_type: "refresh_token",
      refresh_token: input.refresh,
      client_id: CLIENT_ID,
      scope: REFRESH_SCOPES.join(" "),
    },
  })
}

export async function requestProfile(input: { access: string; endpoint?: string; httpFetch?: typeof fetch }) {
  const response = await (input.httpFetch ?? fetch)(input.endpoint ?? PROFILE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${input.access}`,
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Claude profile request failed: ${response.status}`)
  const value = await response.json()
  if (!isRecord(value) || !isRecord(value.account) || typeof value.account.uuid !== "string" || !value.account.uuid) {
    throw new Error("Claude profile response is missing account.uuid")
  }
  return value.account.uuid
}

async function requestTokens(input: {
  operation: "exchange" | "refresh"
  endpoint: string
  httpFetch: typeof fetch
  requireRefresh: boolean
  body: Record<string, string>
}) {
  const response = await input.httpFetch(input.endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Claude token ${input.operation} failed: ${response.status}`)
  return parseTokenResponse(await response.json(), input.requireRefresh)
}

function parseTokenResponse(value: unknown, requireRefresh: boolean): TokenResponse {
  if (!isRecord(value)) throw new Error("Claude token response is invalid")
  if (typeof value.access_token !== "string" || !value.access_token) {
    throw new Error("Claude token response is missing access_token")
  }
  if (typeof value.expires_in !== "number" || !Number.isFinite(value.expires_in) || value.expires_in <= 0) {
    throw new Error("Claude token response is missing expires_in")
  }
  if (requireRefresh && (typeof value.refresh_token !== "string" || !value.refresh_token)) {
    throw new Error("Claude token response is missing refresh_token")
  }

  return {
    access_token: value.access_token,
    expires_in: value.expires_in,
    ...(typeof value.refresh_token === "string" && value.refresh_token ? { refresh_token: value.refresh_token } : {}),
    ...(typeof value.refresh_token_expires_in === "number"
      ? { refresh_token_expires_in: value.refresh_token_expires_in }
      : {}),
    ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
  }
}

async function startOAuthCallback(state: string): Promise<OAuthCallback> {
  let resolveCode: (code: string) => void
  let rejectCode: (error: Error) => void
  let codeResolved = false
  let closed = false
  let pendingResponse: ServerResponse | undefined
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  code.catch(() => {})

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname !== "/callback") {
      response.writeHead(404)
      response.end("Not found")
      return
    }

    if (url.searchParams.get("state") !== state) {
      const message = "Invalid state parameter"
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      response.end(OauthCallbackPage.error(message, { provider: "Claude" }))
      reject(new Error(message))
      return
    }

    const error = url.searchParams.get("error")
    if (error) {
      const message = url.searchParams.get("error_description") ?? error
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(OauthCallbackPage.error(message, { provider: "Claude" }))
      reject(new Error(message))
      return
    }

    const authorizationCode = url.searchParams.get("code")
    if (!authorizationCode) {
      const message = "Authorization code not found"
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      response.end(OauthCallbackPage.error(message, { provider: "Claude" }))
      reject(new Error(message))
      return
    }

    if (codeResolved) {
      response.writeHead(409)
      response.end("Authorization callback already received")
      return
    }

    codeResolved = true
    pendingResponse = response
    resolveCode!(authorizationCode)
  })

  function close() {
    server.close(() => {})
  }

  function complete() {
    if (closed) return
    closed = true
    if (pendingResponse && !pendingResponse.writableEnded) {
      pendingResponse.writeHead(302, { Location: SUCCESS_ENDPOINT })
      pendingResponse.end()
    }
    close()
  }

  function reject(error: Error) {
    if (closed) return
    if (codeResolved) {
      complete()
      return
    }
    closed = true
    close()
    rejectCode!(error)
  }

  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error)
    server.once("error", fail)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    server.close(() => {})
    throw new Error("Failed to start Claude OAuth callback server")
  }

  return {
    redirectUri: `http://localhost:${address.port}/callback`,
    code,
    complete,
    cancel: reject,
  }
}

export async function ClaudeAuthPlugin(input: PluginInput, options: ClaudeAuthPluginOptions = {}): Promise<Hooks> {
  const authorizeEndpoint = options.authorizeEndpoint ?? AUTHORIZE_ENDPOINT
  const tokenEndpoint = options.tokenEndpoint ?? TOKEN_ENDPOINT
  const profileEndpoint = options.profileEndpoint ?? PROFILE_ENDPOINT
  const apiEndpoint = options.apiEndpoint ?? API_ENDPOINT
  const httpFetch = options.httpFetch ?? fetch
  const now = options.now ?? Date.now
  const deviceID = options.deviceID ?? loadClaudeDeviceID
  const callbacks = new Set<OAuthCallback>()
  let utilityModel: Model | undefined

  return {
    async dispose() {
      for (const callback of callbacks) callback.cancel(new Error("Claude OAuth login cancelled"))
      callbacks.clear()
    },
    provider: {
      id: "anthropic",
      async models(provider, ctx) {
        if (ctx.auth?.type !== "oauth") {
          utilityModel = undefined
          return provider.models
        }
        utilityModel = UTILITY_MODELS.map((id) =>
          Object.values(provider.models).find((model) => model.api.id === id),
        ).find((model) => model !== undefined)
        const models = { ...provider.models }
        const opus = models["claude-opus-4-8"]
        if (!models["claude-opus-5"] && opus) {
          models["claude-opus-5"] = {
            ...opus,
            id: "claude-opus-5",
            name: "Claude Opus 5",
            family: "claude-opus",
            api: {
              ...opus.api,
              id: "claude-opus-5",
            },
            release_date: "2026-07-24",
          }
        }
        return Object.fromEntries(
          SUBSCRIPTION_MODELS.flatMap((modelID) => {
            const model = models[modelID]
            if (!model) return []
            return [
              [
                modelID,
                {
                  ...model,
                  cost: {
                    input: 0,
                    output: 0,
                    cache: { read: 0, write: 0 },
                  },
                },
              ] as const,
            ]
          }),
        )
      },
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        let refreshPromise:
          | Promise<{
              access: string
              refresh: string
              expires: number
            }>
          | undefined
        let accountID = (auth as typeof auth & { accountId?: string }).accountId
        let profilePromise: Promise<string> | undefined
        let deviceIDPromise: Promise<string> | undefined
        const sessions = new Map<string, string>()

        const refresh = (refreshToken: string) =>
          refreshPromise ??
          (refreshPromise = refreshAccessToken({
            refresh: refreshToken,
            endpoint: tokenEndpoint,
            httpFetch,
          })
            .then(async (tokens) => {
              const next = {
                access: tokens.access_token,
                refresh: tokens.refresh_token ?? refreshToken,
                expires: now() + tokens.expires_in * 1000,
              }
              await input.client.auth.set({
                path: { id: "anthropic" },
                body: {
                  type: "oauth",
                  refresh: next.refresh,
                  access: next.access,
                  expires: next.expires,
                  ...(accountID && { accountId: accountID }),
                },
              })
              return next
            })
            .finally(() => {
              refreshPromise = undefined
            }))

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            const source = new Request(requestInput, init)
            if (!new URL(source.url).pathname.endsWith("/v1/messages")) return httpFetch(requestInput, init)

            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return httpFetch(requestInput, init)
            const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }
            accountID ??= authWithAccount.accountId

            const credentials =
              currentAuth.access && currentAuth.expires > now() + REFRESH_WINDOW_MS
                ? {
                    access: currentAuth.access,
                    refresh: currentAuth.refresh,
                    expires: currentAuth.expires,
                  }
                : await refresh(currentAuth.refresh)

            const target = new URL(apiEndpoint)
            target.searchParams.set("beta", "true")
            const auxiliary = source.headers.get("x-opencode-claude-request") === "title"
            const sourceSessionID =
              source.headers.get("x-claude-code-session-id") ??
              source.headers.get("x-session-id") ??
              crypto.randomUUID()
            const sessionID = sessions.get(sourceSessionID) ?? crypto.randomUUID()
            sessions.set(sourceSessionID, sessionID)
            const sourceParentSessionID = source.headers.get("x-parent-session-id")
            const parentSessionID = sourceParentSessionID
              ? (sessions.get(sourceParentSessionID) ?? crypto.randomUUID())
              : undefined
            if (sourceParentSessionID && parentSessionID) sessions.set(sourceParentSessionID, parentSessionID)
            const resolvedAccountID =
              accountID ??
              (await (profilePromise ??= requestProfile({
                access: credentials.access,
                endpoint: profileEndpoint,
                httpFetch,
              }).then(async (value) => {
                accountID = value
                const latest = await getAuth()
                if (latest.type === "oauth") {
                  await input.client.auth.set({
                    path: { id: "anthropic" },
                    body: {
                      type: "oauth",
                      refresh: latest.refresh,
                      access: latest.access,
                      expires: latest.expires,
                      ...(value && { accountId: value }),
                    },
                  })
                }
                return value
              })))
            const resolvedDeviceID = await (deviceIDPromise ??= deviceID())
            const body = await rewriteMessageBody(source, {
              accountID: resolvedAccountID,
              auxiliary,
              deviceID: resolvedDeviceID,
              parentSessionID,
              sessionID,
            })

            const send = (access: string) => {
              const headers = new Headers(source.headers)
              headers.delete("x-api-key")
              headers.delete("authorization")
              headers.delete("x-session-affinity")
              headers.delete("x-session-id")
              headers.delete("x-parent-session-id")
              headers.delete("x-opencode-claude-request")
              headers.delete("x-stainless-helper-method")
              headers.set("authorization", `Bearer ${access}`)
              headers.set("anthropic-version", ANTHROPIC_VERSION)
              headers.set("anthropic-beta", auxiliary ? ANTHROPIC_AUXILIARY_BETA : ANTHROPIC_BETA)
              headers.set("anthropic-dangerous-direct-browser-access", "true")
              headers.set("x-app", "cli")
              headers.set("x-claude-code-session-id", sessionID)
              headers.set("x-client-request-id", crypto.randomUUID())
              headers.set("accept", "application/json")
              headers.set("user-agent", USER_AGENT)
              headers.set("x-stainless-arch", process.arch)
              headers.set("x-stainless-lang", "js")
              headers.set("x-stainless-os", stainlessOS())
              headers.set("x-stainless-package-version", STAINLESS_PACKAGE_VERSION)
              headers.set("x-stainless-retry-count", "0")
              headers.set("x-stainless-runtime", "node")
              headers.set("x-stainless-runtime-version", STAINLESS_RUNTIME_VERSION)
              headers.set("x-stainless-timeout", "600")
              return httpFetch(new Request(new Request(target, source.clone()), { headers, ...(body ? { body } : {}) }))
            }

            const response = await send(credentials.access)
            const rejected =
              response.status === 401 ||
              (response.status === 403 && (await response.clone().text()).includes("OAuth token has been revoked"))
            if (!rejected) return response

            const latest = await getAuth()
            if (latest.type !== "oauth") return response
            await response.body?.cancel()
            return send((await refresh(latest.refresh)).access)
          },
        }
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
            const callback = await startOAuthCallback(state)
            callbacks.add(callback)

            return {
              url: buildAuthorizeUrl({
                redirectUri: callback.redirectUri,
                challenge: pkce.challenge,
                state,
                endpoint: authorizeEndpoint,
              }),
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await exchangeAuthorizationCode({
                    code: await callback.code,
                    redirectUri: callback.redirectUri,
                    verifier: pkce.verifier,
                    state,
                    endpoint: tokenEndpoint,
                    httpFetch,
                  })
                  const accountID = await requestProfile({
                    access: tokens.access_token,
                    endpoint: profileEndpoint,
                    httpFetch,
                  })
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token!,
                    access: tokens.access_token,
                    expires: now() + tokens.expires_in * 1000,
                    accountId: accountID,
                  }
                } finally {
                  callback.complete()
                  callbacks.delete(callback)
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
    "experimental.provider.small_model": async (request, output) => {
      if (request.provider.id !== "anthropic") return
      output.model = utilityModel
    },
    "chat.params": async (request, output) => {
      if (request.model.providerID !== "anthropic") return
      if (request.provider.options.apiKey !== OAUTH_DUMMY_KEY) return
      if (request.agent === "title") {
        output.maxOutputTokens = 32_000
        output.options.thinking = { type: "disabled" }
        delete output.options.effort
        return
      }
      output.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS
      output.options.thinking ??= { type: "adaptive" }
      output.options.effort ??= "medium"
    },
    "chat.headers": async (request, output) => {
      if (request.model.providerID !== "anthropic") return
      if (request.provider.options.apiKey !== OAUTH_DUMMY_KEY) return
      if (request.agent === "title") output.headers["x-opencode-claude-request"] = "title"
    },
  }
}

export async function loadClaudeDeviceID(filepath = DEVICE_ID_FILE) {
  return Flock.withLock(`anthropic-device-id:${filepath}`, async () => {
    const existing = await readClaudeDeviceID(filepath)
    if (existing) {
      await chmod(filepath, 0o600)
      return existing
    }

    await mkdir(path.dirname(filepath), { recursive: true })
    const value = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")
    const pending = `${filepath}.${process.pid}.${crypto.randomUUID()}.tmp`
    await writeFile(pending, value, { flag: "wx", mode: 0o600 })
    await rename(pending, filepath).finally(() => unlink(pending).catch(() => undefined))
    return value
  })
}

async function readClaudeDeviceID(filepath: string) {
  const value = await readFile(filepath, "utf8").catch((error) => {
    if (hasErrorCode(error, "ENOENT")) return undefined
    throw error
  })
  if (value === undefined) return undefined
  const result = value.trim()
  if (!DEVICE_ID_PATTERN.test(result)) return undefined
  return result
}

function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

async function rewriteMessageBody(
  request: Request,
  input: {
    accountID: string
    auxiliary: boolean
    deviceID: string
    parentSessionID?: string
    sessionID: string
  },
) {
  const value = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (!isRecord(value)) return undefined
  const system = Array.isArray(value.system)
    ? value.system
    : typeof value.system === "string"
      ? [{ type: "text", text: value.system }]
      : []
  const messages = Array.isArray(value.messages) ? value.messages : []
  const metadata = {
    user_id: JSON.stringify({
      device_id: input.deviceID,
      account_uuid: input.accountID,
      session_id: input.sessionID,
      ...(input.parentSessionID && { parent_session_id: input.parentSessionID }),
    }),
  }
  const rewrittenSystem = [
    { type: "text", text: input.auxiliary ? CLAUDE_CODE_AUXILIARY_BILLING : CLAUDE_CODE_BILLING },
    { type: "text", text: CLAUDE_AGENT_IDENTITY },
    ...system,
  ]
  if (input.auxiliary) {
    return JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      messages,
      system: rewrittenSystem,
      tools: [],
      metadata,
      max_tokens: 32_000,
      thinking: { type: "disabled" },
      temperature: 1,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      stream: true,
    })
  }
  return JSON.stringify({
    model: value.model,
    messages,
    system: rewrittenSystem,
    tools: Array.isArray(value.tools) ? value.tools : [],
    metadata,
    max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    thinking: { type: "adaptive" },
    context_management: {
      edits: [{ type: "clear_thinking_20251015", keep: "all" }],
    },
    output_config: { effort: "medium" },
    diagnostics: {
      previous_message_id: null,
    },
    stream: true,
  })
}
