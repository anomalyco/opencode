export type SessionMessagePart = {
    type?: string;
    text?: string;
};
export type SessionMessage = {
    info?: Record<string, unknown>;
    parts?: SessionMessagePart[];
};
export declare function extractSessionMessages(messagesResponse: unknown): SessionMessage[] | undefined;
