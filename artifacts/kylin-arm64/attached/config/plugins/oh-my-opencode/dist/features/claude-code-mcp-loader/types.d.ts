export type McpScope = "user" | "project" | "local";
export interface McpOAuthConfig {
    clientId?: string;
    scopes?: string[];
}
export interface ClaudeCodeMcpServer {
    type?: "http" | "sse" | "stdio";
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    oauth?: McpOAuthConfig;
    scope?: McpScope;
    projectPath?: string;
    disabled?: boolean;
}
export interface ClaudeCodeMcpConfig {
    mcpServers?: Record<string, ClaudeCodeMcpServer>;
}
export interface McpLocalConfig {
    type: "local";
    command: string[];
    environment?: Record<string, string>;
    enabled?: boolean;
}
export interface McpRemoteConfig {
    type: "remote";
    url: string;
    headers?: Record<string, string>;
    oauth?: McpOAuthConfig;
    enabled?: boolean;
}
export type McpServerConfig = McpLocalConfig | McpRemoteConfig;
export interface LoadedMcpServer {
    name: string;
    scope: McpScope;
    config: McpServerConfig;
}
export interface McpLoadResult {
    servers: Record<string, McpServerConfig>;
    loadedServers: LoadedMcpServer[];
}
