import type { TranscriptEntry } from "./types";
export declare function getTranscriptPath(sessionId: string): string;
export declare function appendTranscriptEntry(sessionId: string, entry: TranscriptEntry): void;
/**
 * Clear transcript cache for a specific session or all sessions.
 * Call on session.deleted to prevent memory accumulation.
 */
export declare function clearTranscriptCache(sessionId?: string): void;
export declare function hasTranscriptCacheEntry(sessionId: string): boolean;
/**
 * Build Claude Code compatible transcript from session messages.
 * Uses per-session cache to avoid redundant session.messages() API calls.
 * First call fetches and caches; subsequent calls reuse cached base entries.
 */
export declare function buildTranscriptFromSession(client: {
    session: {
        messages: (opts: {
            path: {
                id: string;
            };
            query?: {
                directory: string;
            };
        }) => Promise<unknown>;
    };
}, sessionId: string, directory: string, currentToolName: string, currentToolInput: Record<string, unknown>): Promise<string | null>;
export declare function deleteTempTranscript(path: string | null): void;
