import type { Hooks, PluginInput } from "@opencode-ai/plugin";
export interface IdTokenClaims {
    chatgpt_account_id?: string;
    organizations?: Array<{
        id: string;
    }>;
    email?: string;
    "https://api.openai.com/auth"?: {
        chatgpt_account_id?: string;
    };
}
export declare function parseJwtClaims(token: string): IdTokenClaims | undefined;
export declare function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined;
export declare function extractAccountId(tokens: TokenResponse): string | undefined;
interface TokenResponse {
    id_token: string;
    access_token: string;
    refresh_token: string;
    expires_in?: number;
}
export declare function CodexAuthPlugin(input: PluginInput): Promise<Hooks>;
export {};
