import type { ClaudeCodeAgentConfig } from "../claude-code-agent-loader/types";
import type { LoadedPlugin } from "./types";
export declare function loadPluginAgents(plugins: LoadedPlugin[]): Record<string, ClaudeCodeAgentConfig>;
