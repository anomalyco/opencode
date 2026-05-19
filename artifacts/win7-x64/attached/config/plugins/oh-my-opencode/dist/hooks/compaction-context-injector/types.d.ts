export interface CompactionContextInjector {
    capture: (sessionID: string) => Promise<void>;
    inject: (sessionID?: string) => string;
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
}
export type CompactionContextClient = {
    client: {
        session: {
            messages: (input: {
                path: {
                    id: string;
                };
            }) => Promise<unknown>;
            promptAsync: (input: {
                path: {
                    id: string;
                };
                body: {
                    noReply?: boolean;
                    agent?: string;
                    model?: {
                        providerID: string;
                        modelID: string;
                    };
                    tools?: Record<string, boolean>;
                    parts: Array<{
                        type: "text";
                        text: string;
                    }>;
                };
                query?: {
                    directory: string;
                };
            }) => Promise<unknown>;
        };
    };
    directory: string;
};
