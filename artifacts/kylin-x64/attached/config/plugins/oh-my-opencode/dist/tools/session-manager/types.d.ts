export interface SessionMessage {
    id: string;
    role: "user" | "assistant";
    agent?: string;
    time?: {
        created: number;
        updated?: number;
    };
    parts: MessagePart[];
}
export interface MessagePart {
    id: string;
    type: string;
    text?: string;
    thinking?: string;
    tool?: string;
    callID?: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
}
export interface SessionInfo {
    id: string;
    message_count: number;
    first_message?: Date;
    last_message?: Date;
    agents_used: string[];
    has_todos: boolean;
    has_transcript: boolean;
    todos?: TodoItem[];
    transcript_entries?: number;
}
export interface TodoItem {
    id?: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: string;
}
export interface SearchResult {
    session_id: string;
    message_id: string;
    role: string;
    excerpt: string;
    match_count: number;
    timestamp?: number;
}
export interface SessionMetadata {
    id: string;
    version?: string;
    projectID: string;
    directory: string;
    title?: string;
    parentID?: string;
    time: {
        created: number;
        updated: number;
    };
    summary?: {
        additions: number;
        deletions: number;
        files: number;
    };
}
export interface SessionListArgs {
    limit?: number;
    offset?: number;
    from_date?: string;
    to_date?: string;
    project_path?: string;
}
export interface SessionReadArgs {
    session_id: string;
    include_todos?: boolean;
    include_transcript?: boolean;
    limit?: number;
}
export interface SessionSearchArgs {
    query: string;
    session_id?: string;
    case_sensitive?: boolean;
    limit?: number;
}
export interface SessionInfoArgs {
    session_id: string;
}
export interface SessionDeleteArgs {
    session_id: string;
    confirm: boolean;
}
