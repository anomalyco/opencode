import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types";
import type { McpOAuthProvider } from "../mcp-oauth/provider";
import type { SkillScope } from "../opencode-skill-loader/types";
export type SkillMcpConfig = Record<string, ClaudeCodeMcpServer>;
export type McpTransport = Transport;
export interface McpClient {
    connect: Client["connect"];
    close: Client["close"];
    listTools: Client["listTools"];
    listResources: Client["listResources"];
    listPrompts: Client["listPrompts"];
    callTool: Client["callTool"];
    readResource: Client["readResource"];
    getPrompt: Client["getPrompt"];
}
export interface SkillMcpClientInfo {
    serverName: string;
    skillName: string;
    sessionID: string;
    scope?: SkillScope | "local";
}
export interface SkillMcpServerContext {
    config: ClaudeCodeMcpServer;
    skillName: string;
}
/**
 * Connection type for a managed MCP client.
 * - "stdio": Local process via stdin/stdout
 * - "http": Remote server via HTTP (Streamable HTTP transport)
 */
export type ConnectionType = "stdio" | "http";
export interface ManagedClientBase {
    client: McpClient;
    skillName: string;
    lastUsedAt: number;
    connectionType: ConnectionType;
}
export interface ManagedStdioClient extends ManagedClientBase {
    connectionType: "stdio";
    transport: McpTransport;
}
export interface ManagedHttpClient extends ManagedClientBase {
    connectionType: "http";
    transport: McpTransport;
}
export type ManagedClient = ManagedStdioClient | ManagedHttpClient;
export interface ProcessCleanupHandler {
    signal: NodeJS.Signals;
    listener: () => void;
}
export type OAuthProviderLike = Pick<McpOAuthProvider, "tokens" | "login" | "refresh">;
export type OAuthProviderFactory = (options: {
    serverUrl: string;
    clientId?: string;
    scopes?: string[];
}) => OAuthProviderLike;
export interface SkillMcpManagerState {
    clients: Map<string, ManagedClient>;
    pendingConnections: Map<string, Promise<McpClient>>;
    disconnectedSessions: Map<string, number>;
    authProviders: Map<string, McpOAuthProvider>;
    cleanupRegistered: boolean;
    cleanupInterval: ReturnType<typeof setInterval> | null;
    cleanupHandlers: ProcessCleanupHandler[];
    idleTimeoutMs: number;
    shutdownGeneration: number;
    inFlightConnections: Map<string, number>;
    disposed: boolean;
    createOAuthProvider: OAuthProviderFactory;
}
export interface SkillMcpClientConnectionParams {
    state: SkillMcpManagerState;
    clientKey: string;
    info: SkillMcpClientInfo;
    config: ClaudeCodeMcpServer;
}
