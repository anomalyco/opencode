import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { Log } from "../util/log"
import { McpAuth } from "./auth"

const log = Log.create({ service: "mcp.oauth" })

const OAUTH_CALLBACK_PORT = 19876
const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback"

function isEntraV2(url: string | URL) {
  const endpoint = new URL(typeof url === "string" ? url : url.toString())
  return endpoint.hostname === "login.microsoftonline.com" && endpoint.pathname.includes("/oauth2/v2.0/")
}

function mergeScope(...values: Array<string | undefined>) {
  const scope = Array.from(
    new Set(
      values
        .flatMap((value) => value?.split(/\s+/).map((item) => item.trim()) ?? [])
        .filter((item): item is string => item.length > 0),
    ),
  )
  if (!scope.length) return undefined
  return scope.join(" ")
}
// Refresh tokens 5 minutes before they expire (matches VS Code's approach)
const REFRESH_BUFFER_SECS = 5 * 60

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
    return `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "OpenCode",
      client_uri: "https://opencode.ai",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
      scope: this.config.scope,
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

    // Proactively refresh if token is expired or about to expire
    if (entry.tokens.expiresAt && entry.tokens.refreshToken) {
      const remaining = entry.tokens.expiresAt - Date.now() / 1000
      if (remaining < REFRESH_BUFFER_SECS) {
        log.info("token expired or expiring soon, attempting refresh", {
          mcpName: this.mcpName,
          remainingSecs: Math.floor(remaining),
        })
        const refreshed = await this.refresh(entry.tokens.refreshToken)
        if (refreshed) return refreshed
        // Refresh failed - return undefined to trigger full re-auth
        if (remaining <= 0) return undefined
      }
    }

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

  /**
   * Attempt to refresh the access token using a stored refresh token.
   * Returns new OAuthTokens on success, or undefined on failure.
   */
  private async refresh(refreshToken: string): Promise<OAuthTokens | undefined> {
    const client = await this.clientInformation()
    if (!client) return undefined

    // Discover authorization server URL
    let authorizationServerUrl: string | URL = new URL("/", this.serverUrl)
    try {
      const resource = await discoverOAuthProtectedResourceMetadata(this.serverUrl)
      if (resource.authorization_servers?.length) {
        authorizationServerUrl = resource.authorization_servers[0]
      }
    } catch {
      // Fall back to server base URL
    }

    const metadata = await discoverAuthorizationServerMetadata(authorizationServerUrl).catch(() => undefined)
    const resourceUrl = await this.validateResourceURL(this.serverUrl)

    try {
      const tokens = await refreshAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation: client,
        refreshToken,
        resource: resourceUrl ?? undefined,
        addClientAuthentication: this.addClientAuthentication,
      })
      await this.saveTokens(tokens)
      log.info("token refresh successful", { mcpName: this.mcpName })
      return tokens
    } catch (error) {
      log.info("token refresh failed", {
        mcpName: this.mcpName,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const entry = await McpAuth.getForUrl(this.mcpName, this.serverUrl)
    await McpAuth.updateTokens(
      this.mcpName,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? entry?.tokens?.refreshToken,
        expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
        scope: tokens.scope,
      },
      this.serverUrl,
    )
    log.info("saved oauth tokens", { mcpName: this.mcpName })
  }

  async validateResourceURL(serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
    // Use resource indicator from protected resource metadata when available.
    // Some providers (including Microsoft Entra ID v1 endpoints) still require this.
    return resource ? new URL(resource) : undefined
  }

  addClientAuthentication = (
    _headers: Headers,
    params: URLSearchParams,
    url: string | URL,
    _metadata?: any,
  ): Promise<void> => {
    // For Microsoft Entra ID token endpoint, ensure client_id is in the request body
    // and remove resource parameter for v2.0 endpoints
    return (async () => {
      if (isEntraV2(url)) {
        // Ensure client_id is in the request body for public clients
        if (this.config.clientId && !params.has("client_id")) {
          params.set("client_id", this.config.clientId)
          log.info("added client_id to token request", { mcpName: this.mcpName })
        }
        // Remove resource parameter - Microsoft Entra ID v2.0 uses scope only
        params.delete("resource")
        log.info("removed resource parameter from token request", { mcpName: this.mcpName })
      }
    })()
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const url = new URL(authorizationUrl.toString())

    if (isEntraV2(url)) {
      url.searchParams.delete("resource")
      const scope = mergeScope(url.searchParams.get("scope") ?? undefined, this.config.scope)
      if (scope) {
        url.searchParams.set("scope", mergeScope(scope, "offline_access") ?? scope)
      }
    }

    log.info("redirecting to authorization", { mcpName: this.mcpName, url: url.toString() })
    await this.callbacks.onRedirect(url)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await McpAuth.updateCodeVerifier(this.mcpName, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const entry = await McpAuth.get(this.mcpName)
    if (!entry?.codeVerifier) {
      throw new Error(`No code verifier saved for MCP server: ${this.mcpName}`)
    }
    return entry.codeVerifier
  }

  async saveState(state: string): Promise<void> {
    await McpAuth.updateOAuthState(this.mcpName, state)
  }

  async state(): Promise<string> {
    const entry = await McpAuth.get(this.mcpName)
    if (!entry?.oauthState) {
      throw new Error(`No OAuth state saved for MCP server: ${this.mcpName}`)
    }
    return entry.oauthState
  }
}

export { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT }
