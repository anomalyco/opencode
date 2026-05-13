import type { PluginInput } from "@opencode-ai/plugin";
import type { OriginalMessageContext, ToolPermission } from "./types";
export interface StoredMessage {
    agent?: string;
    model?: {
        providerID?: string;
        modelID?: string;
        variant?: string;
    };
    tools?: Record<string, ToolPermission>;
}
type OpencodeClient = PluginInput["client"];
/**
 * Finds the nearest message with required fields using SDK (for beta/SQLite backend).
 * Uses client.session.messages() to fetch message data from SQLite.
 */
export declare function findNearestMessageWithFieldsFromSDK(client: OpencodeClient, sessionID: string): Promise<StoredMessage | null>;
/**
 * Finds the FIRST (oldest) message with agent field using SDK (for beta/SQLite backend).
 */
export declare function findFirstMessageWithAgentFromSDK(client: OpencodeClient, sessionID: string): Promise<string | null>;
/**
 * Finds the nearest message with required fields (agent, model.providerID, model.modelID).
 * Reads from JSON files - for stable (JSON) backend.
 *
 * **Version-gated behavior:**
 * - On beta (SQLite backend): Returns null immediately (no JSON storage)
 * - On stable (JSON backend): Reads from JSON files in messageDir
 *
 * @deprecated Use findNearestMessageWithFieldsFromSDK for beta/SQLite backend
 */
export declare function findNearestMessageWithFields(messageDir: string): StoredMessage | null;
/**
 * Finds the FIRST (oldest) message in the session with agent field.
 * Reads from JSON files - for stable (JSON) backend.
 *
 * **Version-gated behavior:**
 * - On beta (SQLite backend): Returns null immediately (no JSON storage)
 * - On stable (JSON backend): Reads from JSON files in messageDir
 *
 * @deprecated Use findFirstMessageWithAgentFromSDK for beta/SQLite backend
 */
export declare function findFirstMessageWithAgent(messageDir: string): string | null;
export declare function generateMessageId(): string;
export declare function generatePartId(): string;
/**
 * Injects a hook message into the session storage.
 *
 * **Version-gated behavior:**
 * - On beta (SQLite backend): Logs warning and skips injection (writes are invisible to SQLite)
 * - On stable (JSON backend): Writes message and part JSON files
 *
 * Features degraded on beta:
 * - Hook message injection (e.g., continuation prompts, context injection) won't persist
 * - Atlas hook's injected messages won't be visible in SQLite backend
 * - Todo continuation enforcer's injected prompts won't persist
 * - Ralph loop's continuation prompts won't persist
 *
 * @param sessionID - Target session ID
 * @param hookContent - Content to inject
 * @param originalMessage - Context from the original message
 * @returns true if injection succeeded, false otherwise
 */
export declare function injectHookMessage(sessionID: string, hookContent: string, originalMessage: OriginalMessageContext): boolean;
export declare function resolveMessageContext(sessionID: string, client: OpencodeClient, messageDir: string | null): Promise<{
    prevMessage: StoredMessage | null;
    firstMessageAgent: string | null;
}>;
export {};
