type ReadyNotificationContext = {
    client: {
        session: {
            get?: (input: {
                path: {
                    id: string;
                };
            }) => Promise<unknown>;
            messages?: (input: {
                path: {
                    id: string;
                };
                query: {
                    directory: string;
                };
            }) => Promise<unknown>;
        };
    };
    directory: string;
};
type ReadyNotificationInput = {
    sessionID: string;
    baseTitle: string;
    baseMessage: string;
};
export declare function buildReadyNotificationContent(ctx: ReadyNotificationContext, input: ReadyNotificationInput): Promise<{
    title: string;
    message: string;
}>;
export {};
