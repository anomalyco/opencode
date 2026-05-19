import type { ClaudeCodeAgentConfig } from "./types";
export declare function loadUserAgents(): Record<string, ClaudeCodeAgentConfig>;
export declare function loadProjectAgents(directory?: string): Record<string, ClaudeCodeAgentConfig>;
export declare function loadOpencodeGlobalAgents(): Record<string, ClaudeCodeAgentConfig>;
export declare function loadOpencodeProjectAgents(directory?: string): Record<string, ClaudeCodeAgentConfig>;
