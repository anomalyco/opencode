import { createServer } from "node:http"
import { Deferred, Effect } from "effect"
import { Connector } from "../../connector"
import { Credential } from "../../credential"
import { InstallationVersion } from "../../installation/version"

const clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
const issuer = "https://auth.openai.com"
const callbackPort = 1455
const pollingSafetyMargin = 3000

type Pkce = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type Claims = {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string }
}

export const browser = {
  connectorID: Connector.ID.make("openai"),
  method: new Connector.OAuthMethod({
    id: Connector.MethodID.make("chatgpt-browser"),
    type: "oauth",
    label: "ChatGPT Pro/Plus (browser)",
  }),
  authorize: () =>
    Effect.gen(function* () {
      const pkce = yield* Effect.promise(generatePKCE)
      const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
      const code = yield* Deferred.make<string, Error>()
      const redirect = `http://localhost:${callbackPort}/auth/callback`
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://localhost:${callbackPort}`)
        if (url.pathname !== "/auth/callback") {
          response.writeHead(404).end("Not found")
          return
        }
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
        const value = url.searchParams.get("code")
        if (error) {
          Effect.runFork(Deferred.fail(code, new Error(error)))
          response.writeHead(400, { "Content-Type": "text/html" }).end(errorPage(error))
          return
        }
        if (!value || url.searchParams.get("state") !== state) {
          const message = value ? "Invalid OAuth state" : "Missing authorization code"
          Effect.runFork(Deferred.fail(code, new Error(message)))
          response.writeHead(400, { "Content-Type": "text/html" }).end(errorPage(message))
          return
        }
        Effect.runFork(Deferred.succeed(code, value))
        response.writeHead(200, { "Content-Type": "text/html" }).end(successPage)
      })
      yield* Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(callbackPort, "localhost", () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          server.close()
        }),
      )
      return {
        mode: "auto" as const,
        url: authorizeURL(redirect, pkce, state),
        instructions: "Complete authorization in your browser. This window will close automatically.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) => exchange(value, redirect, pkce)),
          Effect.map(credential),
        ),
      }
    }),
  refresh: (value) => refresh(value),
} satisfies Connector.OAuthImplementation

export const headless = {
  connectorID: Connector.ID.make("openai"),
  method: new Connector.OAuthMethod({
    id: Connector.MethodID.make("chatgpt-headless"),
    type: "oauth",
    label: "ChatGPT Pro/Plus (headless)",
  }),
  authorize: () =>
    Effect.gen(function* () {
      const device = yield* request<{ device_auth_id: string; user_code: string; interval: string }>(
        `${issuer}/api/accounts/deviceauth/usercode`,
        {
          method: "POST",
          headers: headers("application/json"),
          body: JSON.stringify({ client_id: clientID }),
        },
      )
      const interval = Math.max(Number.parseInt(device.interval) || 5, 1) * 1000
      return {
        mode: "auto" as const,
        url: `${issuer}/codex/device`,
        instructions: `Enter code: ${device.user_code}`,
        callback: Effect.gen(function* () {
          while (true) {
            const response = yield* Effect.tryPromise({
              try: (signal) =>
                fetch(`${issuer}/api/accounts/deviceauth/token`, {
                  method: "POST",
                  headers: headers("application/json"),
                  body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
                  signal,
                }),
              catch: (cause) => cause,
            })
            if (response.ok) {
              const data = (yield* Effect.promise(() => response.json())) as {
                authorization_code: string
                code_verifier: string
              }
              return credential(
                yield* exchange(data.authorization_code, `${issuer}/deviceauth/callback`, {
                  verifier: data.code_verifier,
                  challenge: "",
                }),
              )
            }
            if (response.status !== 403 && response.status !== 404) {
              return yield* Effect.fail(new Error(`Device authorization failed: ${response.status}`))
            }
            yield* Effect.sleep(interval + pollingSafetyMargin)
          }
        }),
      }
    }),
  refresh: (value) => refresh(value),
} satisfies Connector.OAuthImplementation

function headers(contentType: string) {
  return { "Content-Type": contentType, "User-Agent": `opencode/${InstallationVersion}` }
}

function exchange(code: string, redirect: string, pkce: Pkce) {
  return request<TokenResponse>(`${issuer}/oauth/token`, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
}

function refresh(value: Credential.OAuth) {
  return request<TokenResponse>(`${issuer}/oauth/token`, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID,
    }).toString(),
  }).pipe(
    Effect.map((tokens) => {
      const next = credential(tokens)
      return new Credential.OAuth({
        ...next,
        metadata: next.metadata ?? value.metadata,
      })
    }),
  )
}

function request<A>(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return response.json() as Promise<A>
    },
    catch: (cause) => cause,
  })
}

function credential(tokens: TokenResponse) {
  const accountID = extractAccountID(tokens)
  return new Credential.OAuth({
    type: "oauth",
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    metadata: accountID ? { accountID } : undefined,
  })
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)), (byte) => chars[byte % chars.length]).join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}

function authorizeURL(redirect: string, pkce: Pkce, state: string) {
  return `${issuer}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientID,
    redirect_uri: redirect,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  })}`
}

function extractAccountID(tokens: TokenResponse) {
  return claim(tokens.id_token) ?? claim(tokens.access_token)
}

function claim(token: string) {
  const part = token.split(".")[1]
  if (!part) return
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString()) as Claims
    return (
      claims.chatgpt_account_id ??
      claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
      claims.organizations?.[0]?.id
    )
  } catch {
    return
  }
}

const successPage =
  "<!doctype html><title>OpenCode</title><h1>Authorization successful</h1><p>You can close this window.</p>"
const errorPage = (message: string) =>
  `<!doctype html><title>OpenCode</title><h1>Authorization failed</h1><p>${message.replace(/[&<>"']/g, "")}</p>`
