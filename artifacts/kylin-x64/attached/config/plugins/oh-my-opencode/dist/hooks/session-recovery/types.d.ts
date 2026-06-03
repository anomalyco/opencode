export type ThinkingPartType = "thinking" | "redacted_thinking" | "reasoning";
export type MetaPartType = "step-start" | "step-finish";
export type ContentPartType = "text" | "tool" | "tool_use" | "tool_result";
export interface StoredMessageMeta {
    id: string;
    sessionID: string;
    role: "user" | "assistant";
    parentID?: string;
    time?: {
        created: number;
        completed?: number;
    };
    error?: unknown;
}
export interface StoredTextPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "text";
    text: string;
    synthetic?: boolean;
    ignored?: boolean;
}
export interface StoredToolPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "tool";
    callID: string;
    tool: string;
    state: {
        status: "pending" | "running" | "completed" | "error";
        input: Record<string, unknown>;
        output?: string;
        error?: string;
    };
}
export interface StoredReasoningPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "reasoning";
    text: string;
}
export interface StoredStepPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "step-start" | "step-finish";
}
export type StoredPart = StoredTextPart | StoredToolPart | StoredReasoningPart | StoredStepPart | {
    id: string;
    sessionID: string;
    messageID: string;
    type: string;
    [key: string]: unknown;
};
export interface MessageData {
    info?: {
        id?: string;
        role?: string;
        sessionID?: string;
        parentID?: string;
        error?: unknown;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
            variant?: string;
        };
        system?: string;
        tools?: Record<string, boolean>;
    };
    parts?: Array<{
        type: string;
        id?: string;
        text?: string;
        thinking?: string;
        name?: string;
        input?: Record<string, unknown>;
        callID?: string;
    }>;
}
export interface ResumeConfig {
    sessionID: string;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
        variant?: string;
    };
    tools?: Record<string, boolean>;
}
