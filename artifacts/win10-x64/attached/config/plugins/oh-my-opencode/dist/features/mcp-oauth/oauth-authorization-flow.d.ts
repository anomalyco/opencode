export type OAuthCallbackResult = {
    code: string;
    state: string;
};
export declare function generateCodeVerifier(): string;
export declare function generateCodeChallenge(verifier: string): string;
export declare function buildAuthorizationUrl(authorizationEndpoint: string, options: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scopes?: string[];
    resource?: string;
}): string;
export declare function startCallbackServer(port: number): Promise<OAuthCallbackResult>;
export declare function runAuthorizationCodeRedirect(options: {
    authorizationEndpoint: string;
    callbackPort: number;
    clientId: string;
    redirectUri: string;
    scopes?: string[];
    resource?: string;
}): Promise<{
    code: string;
    verifier: string;
}>;
