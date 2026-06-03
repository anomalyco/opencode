import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types";
import type { OAuthProviderFactory, OAuthProviderLike } from "./types";
export declare function getOrCreateAuthProvider(authProviders: Map<string, OAuthProviderLike>, serverUrl: string, oauth: NonNullable<ClaudeCodeMcpServer["oauth"]>, createOAuthProvider?: OAuthProviderFactory): OAuthProviderLike;
export declare function buildHttpRequestInit(config: ClaudeCodeMcpServer, authProviders: Map<string, OAuthProviderLike>, createOAuthProvider?: OAuthProviderFactory): Promise<RequestInit | undefined>;
export declare function handleStepUpIfNeeded(params: {
    error: Error;
    config: ClaudeCodeMcpServer;
    authProviders: Map<string, OAuthProviderLike>;
    createOAuthProvider?: OAuthProviderFactory;
}): Promise<boolean>;
export declare function handlePostRequestAuthError(params: {
    error: Error;
    config: ClaudeCodeMcpServer;
    authProviders: Map<string, OAuthProviderLike>;
    createOAuthProvider?: OAuthProviderFactory;
    refreshAttempted?: Set<string>;
}): Promise<boolean>;
