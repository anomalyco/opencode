interface SessionMessage {
    info?: {
        agent?: string;
        role?: string;
    };
}
type SessionClient = {
    session: {
        messages: (opts: {
            path: {
                id: string;
            };
        }) => Promise<{
            data?: SessionMessage[];
        }>;
    };
};
export declare function resolveSessionAgent(client: SessionClient, sessionId: string): Promise<string | undefined>;
export {};
