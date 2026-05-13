export interface SessionCreatedEvent {
    type: string;
    properties?: {
        info?: {
            id?: string;
            parentID?: string;
            title?: string;
        };
    };
}
export declare function coerceSessionCreatedEvent(input: {
    type: string;
    properties?: unknown;
}): SessionCreatedEvent;
