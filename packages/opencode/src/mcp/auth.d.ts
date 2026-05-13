import z from "zod";
export declare namespace McpAuth {
    const Tokens: z.ZodObject<{
        accessToken: z.ZodString;
        refreshToken: z.ZodOptional<z.ZodString>;
        expiresAt: z.ZodOptional<z.ZodNumber>;
        scope: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    type Tokens = z.infer<typeof Tokens>;
    const ClientInfo: z.ZodObject<{
        clientId: z.ZodString;
        clientSecret: z.ZodOptional<z.ZodString>;
        clientIdIssuedAt: z.ZodOptional<z.ZodNumber>;
        clientSecretExpiresAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    type ClientInfo = z.infer<typeof ClientInfo>;
    const Entry: z.ZodObject<{
        tokens: z.ZodOptional<z.ZodObject<{
            accessToken: z.ZodString;
            refreshToken: z.ZodOptional<z.ZodString>;
            expiresAt: z.ZodOptional<z.ZodNumber>;
            scope: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        clientInfo: z.ZodOptional<z.ZodObject<{
            clientId: z.ZodString;
            clientSecret: z.ZodOptional<z.ZodString>;
            clientIdIssuedAt: z.ZodOptional<z.ZodNumber>;
            clientSecretExpiresAt: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        codeVerifier: z.ZodOptional<z.ZodString>;
        oauthState: z.ZodOptional<z.ZodString>;
        serverUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    type Entry = z.infer<typeof Entry>;
    function get(mcpName: string): Promise<Entry | undefined>;
    /**
     * Get auth entry and validate it's for the correct URL.
     * Returns undefined if URL has changed (credentials are invalid).
     */
    function getForUrl(mcpName: string, serverUrl: string): Promise<Entry | undefined>;
    function all(): Promise<Record<string, Entry>>;
    function set(mcpName: string, entry: Entry, serverUrl?: string): Promise<void>;
    function remove(mcpName: string): Promise<void>;
    function updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Promise<void>;
    function updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void>;
    function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void>;
    function clearCodeVerifier(mcpName: string): Promise<void>;
    function updateOAuthState(mcpName: string, oauthState: string): Promise<void>;
    function getOAuthState(mcpName: string): Promise<string | undefined>;
    function clearOAuthState(mcpName: string): Promise<void>;
    /**
     * Check if stored tokens are expired.
     * Returns null if no tokens exist, false if no expiry or not expired, true if expired.
     */
    function isTokenExpired(mcpName: string): Promise<boolean | null>;
}
