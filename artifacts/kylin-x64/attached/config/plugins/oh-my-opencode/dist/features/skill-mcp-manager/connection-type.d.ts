import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types";
import type { ConnectionType } from "./types";
/**
 * Determines connection type from MCP server configuration.
 * Priority: explicit type field > url presence > command presence
 */
export declare function getConnectionType(config: ClaudeCodeMcpServer): ConnectionType | null;
