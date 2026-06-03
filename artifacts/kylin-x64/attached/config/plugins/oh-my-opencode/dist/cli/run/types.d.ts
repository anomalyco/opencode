import type { OpencodeClient } from "@opencode-ai/sdk";
export type { OpencodeClient };
export interface RunOptions {
    message: string;
    agent?: string;
    model?: string;
    timestamp?: boolean;
    verbose?: boolean;
    directory?: string;
    port?: number;
    attach?: string;
    onComplete?: string;
    json?: boolean;
    sessionId?: string;
}
export interface ServerConnection {
    client: OpencodeClient;
    cleanup: () => void;
}
export interface RunResult {
    sessionId: string;
    success: boolean;
    durationMs: number;
    messageCount: number;
    summary: string;
}
export interface RunContext {
    client: OpencodeClient;
    sessionID: string;
    directory: string;
    abortController: AbortController;
    verbose?: boolean;
}
export interface Todo {
    id?: string;
    content: string;
    status: string;
    priority: string;
}
export interface SessionStatus {
    type: "idle" | "busy" | "retry";
}
export interface ChildSession {
    id: string;
}
export interface EventPayload {
    type: string;
    properties?: Record<string, unknown>;
}
export interface SessionIdleProps {
    sessionID?: string;
    sessionId?: string;
}
export interface SessionStatusProps {
    sessionID?: string;
    sessionId?: string;
    status?: {
        type?: string;
    };
}
export interface MessageUpdatedProps {
    info?: {
        id?: string;
        sessionID?: string;
        sessionId?: string;
        role?: string;
        modelID?: string;
        providerID?: string;
        agent?: string;
        variant?: string;
    };
}
export interface MessagePartUpdatedProps {
    info?: {
        sessionID?: string;
        sessionId?: string;
        role?: string;
    };
    part?: {
        id?: string;
        sessionID?: string;
        sessionId?: string;
        messageID?: string;
        type?: string;
        text?: string;
        /** Tool name (for part.type === "tool") */
        tool?: string;
        /** Tool state (for part.type === "tool") */
        state?: {
            status?: string;
            input?: Record<string, unknown>;
            output?: string;
        };
        name?: string;
        input?: unknown;
        time?: {
            start?: number;
            end?: number;
        };
    };
}
export interface MessagePartDeltaProps {
    sessionID?: string;
    sessionId?: string;
    messageID?: string;
    partID?: string;
    field?: string;
    delta?: string;
}
export interface ToolExecuteProps {
    sessionID?: string;
    sessionId?: string;
    name?: string;
    input?: Record<string, unknown>;
}
export interface ToolResultProps {
    sessionID?: string;
    sessionId?: string;
    name?: string;
    output?: string;
}
export interface SessionErrorProps {
    sessionID?: string;
    sessionId?: string;
    error?: unknown;
}
export interface TuiToastShowProps {
    title?: string;
    message?: string;
    variant?: "info" | "success" | "warning" | "error";
}
