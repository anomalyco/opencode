import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata, OAuthTokens, OAuthClientInformation, OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
declare const OAUTH_CALLBACK_PORT = 19876;
declare const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
export interface McpOAuthConfig {
    clientId?: string;
    clientSecret?: string;
    scope?: string;
}
export interface McpOAuthCallbacks {
    onRedirect: (url: URL) => void | Promise<void>;
}
export declare class McpOAuthProvider implements OAuthClientProvider {
    private mcpName;
    private serverUrl;
    private config;
    private callbacks;
    constructor(mcpName: string, serverUrl: string, config: McpOAuthConfig, callbacks: McpOAuthCallbacks);
    get redirectUrl(): string;
    get clientMetadata(): OAuthClientMetadata;
    clientInformation(): Promise<OAuthClientInformation | undefined>;
    saveClientInformation(info: OAuthClientInformationFull): Promise<void>;
    tokens(): Promise<OAuthTokens | undefined>;
    saveTokens(tokens: OAuthTokens): Promise<void>;
    redirectToAuthorization(authorizationUrl: URL): Promise<void>;
    saveCodeVerifier(codeVerifier: string): Promise<void>;
    codeVerifier(): Promise<string>;
    saveState(state: string): Promise<void>;
    state(): Promise<string>;
    invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void>;
}
export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH };
