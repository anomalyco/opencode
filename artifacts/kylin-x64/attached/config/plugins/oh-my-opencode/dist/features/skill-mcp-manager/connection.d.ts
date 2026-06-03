import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types";
import type { McpClient, SkillMcpClientInfo, SkillMcpManagerState } from "./types";
export declare function getOrCreateClient(params: {
    state: SkillMcpManagerState;
    clientKey: string;
    info: SkillMcpClientInfo;
    config: ClaudeCodeMcpServer;
}): Promise<McpClient>;
export declare function getOrCreateClientWithRetryImpl(params: {
    state: SkillMcpManagerState;
    clientKey: string;
    info: SkillMcpClientInfo;
    config: ClaudeCodeMcpServer;
}): Promise<McpClient>;
