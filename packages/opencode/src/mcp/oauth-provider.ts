import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { McpAuth } from "./auth"
import { Log } from "../util/log"

const log = Log.create({ service: "mcp.oauth" })

const OAUTH_CALLBACK_PORT = 19876
const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback"

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
}

export interface McpOAuthCallbacks {
  onRedirect: (url: URL) => void | Promise<void>
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: McpOAuthCallbacks,
  ) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "OpenCode",
      client_uri: "https://opencode.ai",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // Check config first (pre-registered client)
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }
    }

    // Check stored client info (from dynamic registration)
    // Use getForUrl to validate credentials are for the current server URL
    const entry = await McpAuth.getForUrl(this.mcpName, this.serverUrl)
    console.log("CLIENT INFO LOOKUP:", this.mcpName, this.serverUrl)
    console.log("ENTRY:", JSON.stringify(entry, null, 2))
    if (entry?.clientInfo) {
      // Check if client secret has expired
      if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000) {
        log.info("client secret expired, need to re-register", { mcpName: this.mcpName })
        return undefined
      }
      return {
        client_id: entry.clientInfo.clientId,
        client_secret: entry.clientInfo.clientSecret,
      }
    }

    // No client info or URL changed - will trigger dynamic registration
    return undefined
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await McpAuth.updateClientInfo(
      this.mcpName,
      {
        clientId: info.client_id,
        clientSecret: info.client_secret,
        clientIdIssuedAt: info.client_id_issued_at,
        clientSecretExpiresAt: info.client_secret_expires_at,
      },
      this.serverUrl,
    )
    log.info("saved dynamically registered client", {
      mcpName: this.mcpName,
      clientId: info.client_id,
    })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    // Use getForUrl to validate tokens are for the current server URL
    const entry = await McpAuth.getForUrl(this.mcpName, this.serverUrl)
    if (!entry?.tokens) return undefined

    return {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
        : undefined,
      scope: entry.tokens.scope,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await McpAuth.updateTokens(
      this.mcpName,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
        scope: tokens.scope,
      },
      this.serverUrl,
    )
    log.info("saved oauth tokens", { mcpName: this.mcpName })
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    log.info("redirecting to authorization", { mcpName: this.mcpName, url: authorizationUrl.toString() })
    await this.callbacks.onRedirect(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    // Use get() not getForUrl() — we want existing data regardless of URL
    const existing = await McpAuth.get(this.mcpName)
    if (existing?.codeVerifier) return
    await McpAuth.set(this.mcpName, {
      ...existing,
      serverUrl: this.serverUrl,
      codeVerifier,
    })
  }

  async codeVerifier(): Promise<string> {
  // Use get() not getForUrl() — verifier saved before URL was stored
  const entry = await McpAuth.get(this.mcpName)
  
  if (!entry?.codeVerifier) {
    throw new Error(`No code verifier found for ${this.mcpName}`)
  }
  
  return entry.codeVerifier
}

  async saveState(state: string): Promise<void> {
    await McpAuth.updateOAuthState(this.mcpName, state)
  }

  async state(): Promise<string> {
    const entry = await McpAuth.get(this.mcpName)
    if (entry?.oauthState) {
      return entry.oauthState
    }

    // Generate a new state if none exists — the SDK calls state() as a
    // generator, not just a reader, so we need to produce a value even when
    // startAuth() hasn't pre-saved one (e.g. during automatic auth on first
    // connect).
    const newState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await McpAuth.updateOAuthState(this.mcpName, newState)
    return newState
  }

  async invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void> {
    log.info("invalidating credentials", { mcpName: this.mcpName, type })
    const entry = await McpAuth.get(this.mcpName)
    if (!entry) {
      return
    }

    switch (type) {
      case "all":
        await McpAuth.remove(this.mcpName)
        break
      case "client":
        delete entry.clientInfo
        await McpAuth.set(this.mcpName, entry)
        break
      case "tokens":
        delete entry.tokens
        await McpAuth.set(this.mcpName, entry)
        break
    }
  }
}

/**
 * Normalized fetch that handles non-standard OAuth error responses.
 * Some servers (e.g. Datadog) return {"errors": [...]} instead of
 * the RFC 6749 standard {"error": "...", "error_description": "..."}.
 * This normalizes those responses before the MCP SDK parses them.
 */
export async function normalizedOAuthFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {

  
  const response = await fetch(input, init)

  

  if (!response.ok) {
    const body = await response.text()

    try {
      const json = JSON.parse(body)

      if (!json.error && Array.isArray(json.errors)) {
        const firstError: string = json.errors[0] ?? ""
        
        // Extract OAuth error code from "error_code - description" format
        // e.g. "invalid_grant - Invalid authorization code" → "invalid_grant"
        const dashIndex = firstError.indexOf(" - ")
        const errorCode = dashIndex > 0 
          ? firstError.substring(0, dashIndex).trim()
          : "invalid_request"
      
        const normalized = {
          error: errorCode,
          error_description: json.errors.join(", "),
        }
      
        return new Response(JSON.stringify(normalized), {
          status: response.status,
          headers: response.headers,
        })
      }
    } catch {
      // not JSON → passthrough
    }


    return new Response(body, {
      status: response.status,
      headers: response.headers,
    })
  }

  return response
}

export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH }
