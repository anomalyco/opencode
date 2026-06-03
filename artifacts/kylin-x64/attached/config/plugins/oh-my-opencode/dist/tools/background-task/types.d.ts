export interface BackgroundTaskArgs {
    description: string;
    prompt: string;
    agent: string;
}
export interface BackgroundOutputArgs {
    task_id: string;
    block?: boolean;
    timeout?: number;
    full_session?: boolean;
    include_thinking?: boolean;
    message_limit?: number;
    since_message_id?: string;
    include_tool_results?: boolean;
    thinking_max_chars?: number;
}
export interface BackgroundCancelArgs {
    taskId?: string;
    all?: boolean;
}
export type BackgroundOutputMessage = {
    info?: {
        role?: string;
        time?: string | {
            created?: number;
        };
        agent?: string;
    };
    parts?: Array<{
        type?: string;
        text?: string;
        content?: string | Array<{
            type: string;
            text?: string;
        }>;
        name?: string;
    }>;
};
export type BackgroundOutputMessagesResult = {
    data?: BackgroundOutputMessage[];
    error?: unknown;
} | BackgroundOutputMessage[];
export type BackgroundOutputClient = {
    session: {
        messages: (args: {
            path: {
                id: string;
            };
        }) => Promise<BackgroundOutputMessagesResult>;
    };
};
export type BackgroundCancelClient = {
    session: {
        abort: (args: {
            path: {
                id: string;
            };
        }) => Promise<unknown>;
    };
};
export type BackgroundOutputManager = Pick<import("../../features/background-agent").BackgroundManager, "getTask">;
export type FullSessionMessagePart = {
    type?: string;
    text?: string;
    thinking?: string;
    content?: string | Array<{
        type?: string;
        text?: string;
    }>;
    output?: string;
};
export type FullSessionMessage = {
    id?: string;
    info?: {
        role?: string;
        time?: string;
        agent?: string;
    };
    parts?: FullSessionMessagePart[];
};
export type ToolContextWithMetadata = {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    metadata?: (input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }) => void;
};
