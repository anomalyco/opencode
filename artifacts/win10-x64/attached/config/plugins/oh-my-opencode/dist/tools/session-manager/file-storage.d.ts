import type { SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types";
export declare function getFileMainSessions(directory?: string): Promise<SessionMetadata[]>;
export declare function getFileAllSessions(): Promise<string[]>;
export declare function fileSessionExists(sessionID: string): Promise<boolean>;
export declare function getFileSessionMessages(sessionID: string): Promise<SessionMessage[]>;
export declare function getFileSessionTodos(sessionID: string): Promise<TodoItem[]>;
export declare function getFileSessionTranscript(sessionID: string): Promise<number>;
export declare function getFileSessionInfo(sessionID: string): Promise<SessionInfo | null>;
