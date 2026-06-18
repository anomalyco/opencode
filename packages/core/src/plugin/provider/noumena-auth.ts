import { createServer } from "node:http"
import { Deferred, Effect } from "effect"
import { Credential } from "../../credential"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"

const defaultAuthorizeURL = "https://code.noumena.com/oauth/authorize"
const defaultTokenURL = "https://api.noumena.com/oauth/token"
const defaultClientID = "noumena-code"
const callbackPort = 1456
const scopes = "user:profile user:inference user:sessions:ncode user:mcp_servers user:file_upload"
export const oauthBetaHeader = "oauth-2025-04-20"

type Pkce = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

const browserMethodID = Integration.MethodID.make("noumena-browser")
const manualMethodID = Integration.MethodID.make("noumena-code")

export const browser = {
  integrationID: Integration.ID.make("noumena"),
  method: {
    id: browserMethodID,
    type: "oauth",
    label: "Noumena Code (browser)",
  },
  authorize: () =>
    Effect.gen(function* () {
      const pkce = yield* Effect.promise(generatePKCE)
      const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
      const code = yield* Deferred.make<string, Error>()
      const redirect = `http://localhost:${callbackPort}/callback`
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://localhost:${callbackPort}`)
        if (url.pathname !== "/callback") {
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
          Effect.flatMap((value) => exchange(value, redirect, pkce, state)),
          Effect.map((tokens) => credential(browserMethodID, tokens)),
        ),
      }
    }),
  refresh: (value) => refresh(value),
} satisfies Integration.OAuthImplementation

export const manual = {
  integrationID: Integration.ID.make("noumena"),
  method: {
    id: manualMethodID,
    type: "oauth",
    label: "Noumena Code (manual code)",
  },
  authorize: () =>
    Effect.gen(function* () {
      const pkce = yield* Effect.promise(generatePKCE)
      const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
      const redirect = manualRedirectURL()
      return {
        mode: "code" as const,
        url: authorizeURL(redirect, pkce, state),
        instructions: "Open the URL, complete authorization, then paste the authorization code.",
        callback: (code: string) =>
          exchange(code, redirect, pkce, state).pipe(Effect.map((tokens) => credential(manualMethodID, tokens))),
      }
    }),
  refresh: (value) => refresh(value),
} satisfies Integration.OAuthImplementation

export function tokenURL() {
  const issuer = process.env.NOUMENA_ISSUER_BASE_URL?.trim().replace(/\/$/, "")
  return issuer ? `${issuer}/oauth/token` : defaultTokenURL
}

function authorizeBaseURL() {
  const web = process.env.NOUMENA_OAUTH_WEB_BASE_URL?.trim().replace(/\/$/, "")
  return web ? `${web}/oauth/authorize` : defaultAuthorizeURL
}

function manualRedirectURL() {
  const web = process.env.NOUMENA_OAUTH_WEB_BASE_URL?.trim().replace(/\/$/, "")
  return web ? `${web}/oauth/code/callback?app=noumena-code` : "https://code.noumena.com/oauth/code/callback?app=noumena-code"
}

function clientID() {
  return process.env.NOUMENA_OAUTH_CLIENT_ID || defaultClientID
}

function headers(contentType: string) {
  return {
    "Content-Type": contentType,
    "User-Agent": `opencode/${InstallationVersion}`,
    "anthropic-beta": oauthBetaHeader,
  }
}

function exchange(code: string, redirect: string, pkce: Pkce, state: string) {
  return request<TokenResponse>(tokenURL(), {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientID(),
      code_verifier: pkce.verifier,
      state,
    }).toString(),
  })
}

function refresh(value: Credential.OAuth) {
  return request<TokenResponse>(tokenURL(), {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID(),
      scope: scopes,
    }).toString(),
  }).pipe(
    Effect.map((tokens) =>
      credential(value.methodID, {
        ...tokens,
        refresh_token: tokens.refresh_token ?? value.refresh,
      }),
    ),
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

function credential(methodID: Integration.MethodID, tokens: TokenResponse) {
  return new Credential.OAuth({
    type: "oauth",
    methodID,
    refresh: tokens.refresh_token ?? "",
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  })
}

function authorizeURL(redirect: string, pkce: Pkce, state: string) {
  return `${authorizeBaseURL()}?${new URLSearchParams({
    code: "true",
    response_type: "code",
    client_id: clientID(),
    redirect_uri: redirect,
    scope: scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  })}`
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

const successPage =
  "<!doctype html><title>OpenCode</title><h1>Authorization successful</h1><p>You can close this window.</p>"
const errorPage = (message: string) =>
  `<!doctype html><title>OpenCode</title><h1>Authorization failed</h1><p>${message.replace(/[&<>\"']/g, "")}</p>`
