import type { PluginInput } from "@opencode-ai/plugin";
import type { SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types";
export interface GetMainSessionsOptions {
    directory?: string;
}
export declare function setStorageClient(client: PluginInput["client"]): void;
export declare function resetStorageClient(): void;
export declare function getMainSessions(options: GetMainSessionsOptions): Promise<SessionMetadata[]>;
export declare function getAllSessions(): Promise<string[]>;
export { getMessageDir } from "../../shared/opencode-message-dir";
export declare function sessionExists(sessionID: string): Promise<boolean>;
export declare function readSessionMessages(sessionID: string): Promise<SessionMessage[]>;
export declare function readSessionTodos(sessionID: string): Promise<TodoItem[]>;
export declare function readSessionTranscript(sessionID: string): Promise<number>;
export declare function getSessionInfo(sessionID: string): Promise<SessionInfo | null>;
