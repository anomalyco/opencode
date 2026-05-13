export interface OAuthTokenData {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    clientInfo?: {
        clientId: string;
        clientSecret?: string;
    };
}
type TokenStore = Record<string, OAuthTokenData>;
export declare function getMcpOauthStoragePath(): string;
export declare function loadToken(serverHost: string, resource: string): OAuthTokenData | null;
export declare function saveToken(serverHost: string, resource: string, token: OAuthTokenData): boolean;
export declare function deleteToken(serverHost: string, resource: string): boolean;
export declare function listTokensByHost(serverHost: string): TokenStore;
export declare function listAllTokens(): TokenStore;
export {};
