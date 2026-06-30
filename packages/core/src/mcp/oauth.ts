export * as MCPOAuth from "./oauth"

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"

/** Persists the OAuth artifacts for one MCP server session: DCR client info, PKCE verifier, and tokens. */
export interface Store {
  readonly tokens: () => Promise<OAuthTokens | undefined>
  readonly saveTokens: (tokens: OAuthTokens) => Promise<void>
  readonly clientInformation: () => Promise<OAuthClientInformationMixed | undefined>
  readonly saveClientInformation: (info: OAuthClientInformationMixed) => Promise<void>
  readonly codeVerifier: () => Promise<string | undefined>
  readonly saveCodeVerifier: (verifier: string) => Promise<void>
}

export interface Options {
  /** Loopback URL the authorization server redirects back to after the user approves. */
  readonly redirectUrl: string
  /** Space-delimited OAuth scopes to request when the server requires specific ones. */
  readonly scope?: string
  /** Receives the authorization URL so the caller can open a browser and capture the eventual code. */
  readonly onRedirect: (url: URL) => void | Promise<void>
  readonly store: Store
}

/**
 * Builds the MCP SDK's OAuthClientProvider. The SDK drives dynamic client registration, PKCE, and
 * token refresh through these callbacks; we only persist whatever it hands back via `store`.
 */
export const provider = (options: Options): OAuthClientProvider => ({
  redirectUrl: options.redirectUrl,
  clientMetadata: {
    redirect_uris: [options.redirectUrl],
    client_name: "opencode",
    client_uri: "https://opencode.ai",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...(options.scope ? { scope: options.scope } : {}),
  },
  clientInformation: () => options.store.clientInformation(),
  saveClientInformation: (info) => options.store.saveClientInformation(info),
  tokens: () => options.store.tokens(),
  saveTokens: (tokens) => options.store.saveTokens(tokens),
  redirectToAuthorization: (url) => options.onRedirect(url),
  saveCodeVerifier: (verifier) => options.store.saveCodeVerifier(verifier),
  // The SDK only reads the verifier back after saving one earlier in the same flow; a miss means
  // the flow was resumed without its session state, which the SDK surfaces as an auth failure.
  codeVerifier: async () => {
    const verifier = await options.store.codeVerifier()
    if (!verifier) throw new Error("Missing PKCE code verifier for MCP OAuth flow")
    return verifier
  },
})
