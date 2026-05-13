import type { AgentScope, ClaudeCodeAgentConfig, LoadedAgent } from "./types";
export declare function parseMarkdownAgentFile(filePath: string, scope: AgentScope): LoadedAgent | null;
export declare function loadAgentDefinitions(paths: string[], scope: AgentScope): Record<string, ClaudeCodeAgentConfig>;
