import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import open from "open"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

export type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

const CLIENT_APP_ID = "opencode"
const TOKEN_TIMEOUT_MS = 5 * 60 * 1000

function sanitizeAccount(account: string): string {
  return account.trim().replace(/^https?:\/\//i, "").split("/")[0]
}

function accountHost(account: string): string {
  const clean = sanitizeAccount(account)
  if (clean.includes("snowflakecomputing.com")) return `https://${clean}`
  return `https://${clean}.snowflakecomputing.com`
}

// ACCOUNT_NAME for Snowflake auth bodies = first dot-segment uppercased (e.g. AI43986)
function accountName(account: string): string {
  const clean = sanitizeAccount(account)
  return clean.split(".")[0].toUpperCase()
}

function commonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": `${CLIENT_APP_ID}/${InstallationVersion}`,
  }
}

// Binds to 127.0.0.1:0 (OS-assigned port). Returns {port, waitForToken} where
// waitForToken resolves with the IdP token from GET /?token=.
function startLoopback(): Promise<{ port: number; waitForToken: () => Promise<string> }> {
  return new Promise((resolveSetup, rejectSetup) => {
    const callbacks = { resolve: (_: string) => {}, reject: (_: Error) => {} }
    const tokenPromise = new Promise<string>((res, rej) => {
      callbacks.resolve = res
      callbacks.reject = rej
    })
    // timeout is assigned after the server binds; the request handler captures it via closure
    let timeout: ReturnType<typeof setTimeout>

        const server = createServer((req, res) => {
      let token: string | null = null
      try {
        token = new URL(req.url ?? "/", "http://localhost").searchParams.get("token")
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Invalid URL")
        return
      }

      if (!token) {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Missing token parameter")
        return
      }
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end("<html><body><h2>Authentication complete. You may close this window.</h2></body></html>")
      server.close()
      clearTimeout(timeout)
      callbacks.resolve(token)
    })

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        rejectSetup(new Error("Failed to bind loopback server"))
        return
      }
      // Timeout fires independently; cleared in the success path so the process can exit cleanly
      timeout = setTimeout(() => {
        server.close()
        callbacks.reject(new Error("Timed out waiting for IdP token after 5 minutes"))
      }, TOKEN_TIMEOUT_MS)

      resolveSetup({
        port: addr.port,
        waitForToken: () => tokenPromise,
      })
    })

    server.on("error", rejectSetup)
  })
}

// POST /session/authenticator-request — returns {ssoUrl, proofKey}
async function requestSsoUrl(account: string, port: number, fetchImpl: FetchLike = fetch): Promise<{ ssoUrl: string; proofKey: string }> {
  const res = await fetchImpl(`${accountHost(account)}/session/authenticator-request?requestId=${randomUUID()}`, {
    method: "POST",
    headers: commonHeaders(),
    body: JSON.stringify({
      data: {
        CLIENT_APP_ID,
        CLIENT_APP_VERSION: InstallationVersion,
        ACCOUNT_NAME: accountName(account),
        AUTHENTICATOR: "externalbrowser",
        BROWSER_MODE_REDIRECT_PORT: String(port),
      },
    }),
  })
  if (!res.ok) throw new Error(`authenticator-request failed: HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { ssoUrl?: string; proofKey?: string } }
  if (!json.data?.ssoUrl || !json.data?.proofKey) throw new Error("Unexpected authenticator-request response shape")
  return { ssoUrl: json.data.ssoUrl, proofKey: json.data.proofKey }
}

// POST /session/v1/login-request — exchanges IdP token for session+master tokens
async function completeLogin(
  account: string,
  idpToken: string,
  proofKey: string,
  port: number,
  fetchImpl: FetchLike = fetch,
): Promise<{ session_token: string; master_token: string; session_expires: number; master_expires: number }> {
  const res = await fetchImpl(
    `${accountHost(account)}/session/v1/login-request?requestId=${randomUUID()}&request_guid=${randomUUID()}`,
    {
      method: "POST",
      headers: commonHeaders(),
      body: JSON.stringify({
        data: {
          CLIENT_APP_ID,
          CLIENT_APP_VERSION: InstallationVersion,
          ACCOUNT_NAME: accountName(account),
          AUTHENTICATOR: "externalbrowser",
          TOKEN: idpToken,
          PROOF_KEY: proofKey,
          BROWSER_MODE_REDIRECT_PORT: String(port),
        },
      }),
    },
  )
  if (!res.ok) throw new Error(`login-request failed: HTTP ${res.status}`)
  const json = (await res.json()) as {
    data?: { token?: string; masterToken?: string; validityInSeconds?: number; masterValidityInSeconds?: number }
  }
  const d = json.data
  if (!d?.token || !d?.masterToken) throw new Error("Unexpected login-request response shape")
  const now = Date.now()
  return {
    session_token: d.token,
    master_token: d.masterToken,
    session_expires: now + (d.validityInSeconds ?? 3600) * 1000,
    master_expires: now + (d.masterValidityInSeconds ?? 14400) * 1000,
  }
}

// Split-phase auth: the plugin's authorize() calls this to bind the loopback and get the SSO URL;
// the returned callback() awaits the redirect and exchanges the IdP token for session tokens.
// Browser-open is intentionally NOT done here — the caller (plugin authorize) opens the URL.
export async function initiateExternalBrowserAuth(
  account: string,
  fetchImpl: FetchLike = fetch,
): Promise<{
  ssoUrl: string
  callback: () => Promise<{
    account: string
    session_token: string
    master_token: string
    session_expires: number
    master_expires: number
  }>
}> {
  const cleanAccount = sanitizeAccount(account)
  const { port, waitForToken } = await startLoopback()
  const { ssoUrl, proofKey } = await requestSsoUrl(cleanAccount, port, fetchImpl)
  return {
    ssoUrl,
    async callback() {
      const idpToken = await waitForToken()
      return { account: cleanAccount, ...(await completeLogin(cleanAccount, idpToken, proofKey, port, fetchImpl)) }
    },
  }
}

// Full interactive flow: loopback server + authenticator-request + open browser + login-request.
export async function performExternalBrowserAuth(account: string): Promise<{
  account: string
  session_token: string
  master_token: string
  session_expires: number
  master_expires: number
}> {
  const cleanAccount = sanitizeAccount(account)
  const { port, waitForToken } = await startLoopback()
  const { ssoUrl, proofKey } = await requestSsoUrl(cleanAccount, port)
  await open(ssoUrl)
  const idpToken = await waitForToken()
  return { account: cleanAccount, ...(await completeLogin(cleanAccount, idpToken, proofKey, port)) }
}

// Renew session token via POST /session/token-request (REQUEST_TYPE=RENEW).
export async function renewSessionToken(
  account: string,
  sessionToken: string,
  masterToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ session_token: string; session_expires: number }> {
  const res = await fetchImpl(`${accountHost(account)}/session/token-request?requestId=${randomUUID()}`, {
    method: "POST",
    headers: {
      ...commonHeaders(),
      // Renewal uses the master token in the Authorization header
      Authorization: `Snowflake Token="${masterToken}"`,
    },
    body: JSON.stringify({
      data: { REQUEST_TYPE: "RENEW", oldSessionToken: sessionToken, masterToken },
    }),
  })
  if (!res.ok) throw new Error(`token-request failed: HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { sessionToken?: string; validityInSecondsST?: number } }
  if (!json.data?.sessionToken) throw new Error("Unexpected token-request response shape")
  return {
    session_token: json.data.sessionToken,
    session_expires: Date.now() + (json.data.validityInSecondsST ?? 3600) * 1000,
  }
}

// Token-renewing fetch wrapper for use by provider.ts.
// Uses confirmed Format B: Authorization: Snowflake Token="<session_token>".
// Single-flight renewal: when within 60s of session_expires, renew once (shared promise).
// If master_expires has passed, throws with a clear re-auth message.
export function createSsoFetch(input: {
  account: string
  session: { session_token: string; master_token: string; session_expires: number; master_expires: number }
  renewFn?: typeof renewSessionToken
  fetchImpl?: FetchLike
  onRenew?: (s: { session_token: string; session_expires: number }) => void
}): FetchLike {
  const currentSession = { ...input.session }
  let renewPromise: Promise<void> | undefined
  const renewFn = input.renewFn ?? renewSessionToken

  return async (url, init) => {
    if (Date.now() >= currentSession.session_expires - 60_000) {
      if (Date.now() >= currentSession.master_expires) {
        throw new Error("Snowflake master token expired — run opencode auth login snowflake-cortex to re-authenticate")
      }
      if (!renewPromise) {
        renewPromise = renewFn(input.account, currentSession.session_token, currentSession.master_token, input.fetchImpl)
          .then((r) => {
            currentSession.session_token = r.session_token
            currentSession.session_expires = r.session_expires
            input.onRenew?.(r)
          })
          .finally(() => {
            renewPromise = undefined
          })
      }
      await renewPromise
    }

    const headers = new Headers(init?.headers)
    // Confirmed Format B — Bearer does NOT work for session tokens against the Cortex REST API
    headers.set("Authorization", `Snowflake Token="${currentSession.session_token}"`)
    return (input.fetchImpl ?? fetch)(url, { ...init, headers })
  }
}
