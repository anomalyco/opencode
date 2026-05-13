type EventInput = {
    event: {
        type: string;
        properties?: Record<string, unknown>;
    };
};
export declare function normalizeSessionStatusToIdle(input: EventInput): EventInput | null;
export {};
