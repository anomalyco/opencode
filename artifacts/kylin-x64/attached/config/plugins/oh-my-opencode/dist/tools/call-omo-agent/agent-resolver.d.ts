import type { PluginInput } from "@opencode-ai/plugin";
export declare function clearCallableAgentsCache(): void;
/**
 * Resolves the set of callable agent names at execute-time by merging the
 * hardcoded `ALLOWED_AGENTS` with any additional agents discovered dynamically
 * via `client.app.agents()`. Custom agents loaded from registered agent
 * directories appear here alongside built-ins.
 *
 * Results are cached per session for 30s to avoid redundant SDK IPC calls.
 *
 * Falls back to `ALLOWED_AGENTS` alone if the dynamic lookup fails.
 *
 * @param client - The plugin client with access to the agent registry
 * @param sessionId - Optional session ID for cache scoping
 * @returns Array of lowercase callable agent names (excludes primary-mode agents)
 */
export declare function resolveCallableAgents(client: PluginInput["client"], sessionId?: string): Promise<string[]>;
