import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
/**
 * Get the effective agent for the session.
 * Priority order:
 * 1. In-memory session agent (most recent, set by /start-work)
 * 2. Boulder state agent (persisted across restarts, fixes #927)
 * 3. Message files (fallback for sessions without boulder state)
 *
 * This fixes issue #927 where after interruption:
 * - In-memory map is cleared (process restart)
 * - Message files return "prometheus" (oldest message from /plan)
 * - But boulder.json has agent: "atlas" (set by /start-work)
 */
export declare function getAgentFromSession(sessionID: string, directory: string, client?: OpencodeClient): Promise<string | undefined>;
export {};
