import { McpOAuthProvider } from "../../features/mcp-oauth/provider";
export interface LoginOptions {
    serverUrl?: string;
    clientId?: string;
    scopes?: string[];
}
export type McpOAuthProviderLike = Pick<McpOAuthProvider, "login">;
export interface LoginDependencies {
    createProvider: (options: Required<Pick<LoginOptions, "serverUrl">> & Omit<LoginOptions, "serverUrl">) => McpOAuthProviderLike;
}
export declare function login(serverName: string, options: LoginOptions, deps?: LoginDependencies): Promise<number>;
