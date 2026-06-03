import type { OAuthTokenData } from "./storage";
import type { OAuthServerMetadata } from "./discovery";
import type { ClientCredentials } from "./dcr";
import { buildAuthorizationUrl, generateCodeChallenge, generateCodeVerifier, startCallbackServer } from "./oauth-authorization-flow";
export type McpOAuthProviderOptions = {
    serverUrl: string;
    clientId?: string;
    scopes?: string[];
};
export declare class McpOAuthProvider {
    private readonly serverUrl;
    private readonly configClientId;
    private readonly scopes;
    private storedCodeVerifier;
    private storedClientInfo;
    private callbackPort;
    constructor(options: McpOAuthProviderOptions);
    tokens(): OAuthTokenData | null;
    saveTokens(tokenData: OAuthTokenData): boolean;
    clientInformation(): ClientCredentials | null;
    redirectUrl(): string;
    saveCodeVerifier(verifier: string): void;
    codeVerifier(): string | null;
    redirectToAuthorization(metadata: OAuthServerMetadata): Promise<{
        code: string;
    }>;
    login(): Promise<OAuthTokenData>;
    refresh(refreshToken: string): Promise<OAuthTokenData>;
}
export { generateCodeVerifier, generateCodeChallenge, buildAuthorizationUrl, startCallbackServer };
