import open from "open"
import { Log } from "../../util/log"
import { A2AAuth } from "./storage"
import { A2AOAuthCallback } from "./callback"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce"

const log = Log.create({ service: "a2a.oauth" })

export interface OAuthConfig {
  authorizationUrl: string
  tokenUrl: string
  scopes: Record<string, string>
}

export interface OAuthFlowResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

export interface PreparedOAuthFlow {
  authorizationUrl: string
  state: string
}

export async function getAccessToken(domain: string, oauthConfig: OAuthConfig): Promise<string> {
  const entry = await A2AAuth.get(domain)

  if (entry?.tokens?.accessToken) {
    const expired = await A2AAuth.isTokenExpired(domain)

    if (expired === false || expired === null) {
      return entry.tokens.accessToken
    }

    if (expired === true && entry.tokens.refreshToken) {
      log.info("access token expired, attempting refresh", { domain })
      try {
        const result = await refreshTokens(domain, oauthConfig, entry.tokens.refreshToken)
        return result.accessToken
      } catch (err) {
        log.warn("refresh token failed, starting new auth flow", { domain, error: String(err) })
      }
    }
  }

  log.info("no valid tokens found, starting oauth flow", { domain })
  const result = await startOAuthFlow(domain, oauthConfig)
  return result.accessToken
}

export async function refreshTokens(
  domain: string,
  oauthConfig: OAuthConfig,
  refreshToken: string,
): Promise<OAuthFlowResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: "opencode",
  })

  const response = await fetch(oauthConfig.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${error}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type: string
  }

  await A2AAuth.updateTokens(domain, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() / 1000 + data.expires_in : undefined,
  })

  log.info("tokens refreshed successfully", { domain })

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

/**
 * Prepares the OAuth flow by generating PKCE codes, state, and building the authorization URL.
 * Does NOT open browser or wait for callback - use this to get the URL for display to user.
 */
export async function prepareOAuthFlow(domain: string, oauthConfig: OAuthConfig): Promise<PreparedOAuthFlow> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateState()

  await A2AAuth.updateCodeVerifier(domain, codeVerifier)
  await A2AAuth.updateOAuthState(domain, state)

  await A2AOAuthCallback.ensureRunning()

  const redirectUri = A2AOAuthCallback.getRedirectUri()
  const scope = Object.keys(oauthConfig.scopes).join(" ")

  const authUrl = new URL(oauthConfig.authorizationUrl)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("client_id", "opencode")
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("state", state)
  authUrl.searchParams.set("code_challenge", codeChallenge)
  authUrl.searchParams.set("code_challenge_method", "S256")
  authUrl.searchParams.set("scope", scope)

  log.info("prepared oauth flow", { domain, url: authUrl.toString() })

  return {
    authorizationUrl: authUrl.toString(),
    state,
  }
}

/**
 * Completes the OAuth flow by opening the browser and waiting for the callback.
 * Call this after prepareOAuthFlow and after user has confirmed they want to authenticate.
 */
export async function executeOAuthFlow(
  domain: string,
  oauthConfig: OAuthConfig,
  preparedFlow: PreparedOAuthFlow,
): Promise<OAuthFlowResult> {
  log.info("executing oauth flow", { domain, url: preparedFlow.authorizationUrl })

  // Register callback BEFORE opening browser to avoid race condition
  // when IdP has an active SSO session and redirects immediately
  const callbackPromise = A2AOAuthCallback.waitForCallback(preparedFlow.state)

  try {
    const subprocess = await open(preparedFlow.authorizationUrl)
    // Wait briefly for the process to fail if it's going to
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 500)
      subprocess.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      subprocess.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout)
          reject(new Error(`Browser open failed with exit code ${code}`))
        }
      })
    })
  } catch (err) {
    // Browser opening failed (e.g., SSH, headless, devcontainer)
    // Log the URL so user can open it manually
    log.warn("failed to open browser, user must open URL manually", { domain, error: String(err) })
    log.info("please open this URL in your browser to authorize:", { url: preparedFlow.authorizationUrl })
    // Don't throw - continue waiting for callback
    // The user can still manually open the URL
  }

  const code = await callbackPromise

  await A2AAuth.clearOAuthState(domain)
  const storedVerifier = await A2AAuth.getCodeVerifier(domain)
  await A2AAuth.clearCodeVerifier(domain)

  if (!storedVerifier) {
    throw new Error("Code verifier not found")
  }

  const redirectUri = A2AOAuthCallback.getRedirectUri()

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: "opencode",
    code_verifier: storedVerifier,
  })

  const response = await fetch(oauthConfig.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${error}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type: string
  }

  await A2AAuth.updateTokens(domain, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() / 1000 + data.expires_in : undefined,
  })

  log.info("oauth flow completed successfully", { domain })

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

/**
 * Complete OAuth flow in one call - prepares and executes.
 * Use prepareOAuthFlow + executeOAuthFlow separately if you need to show URL to user first.
 */
export async function startOAuthFlow(domain: string, oauthConfig: OAuthConfig): Promise<OAuthFlowResult> {
  const prepared = await prepareOAuthFlow(domain, oauthConfig)
  return executeOAuthFlow(domain, oauthConfig, prepared)
}

export async function clearTokens(domain: string): Promise<void> {
  await A2AAuth.remove(domain)
  log.info("tokens cleared", { domain })
}
