import type { McpServerConfig } from "../claude-code-mcp-loader/types";
import type { LoadedPlugin } from "./types";
export declare function loadPluginMcpServers(plugins: LoadedPlugin[]): Promise<Record<string, McpServerConfig>>;
