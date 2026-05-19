export declare function isStepOnlyNoTextParts(parts: unknown): boolean;
export declare function resolveNoTextTailFromSession(args: {
    client: {
        session: {
            messages: (input: {
                path: {
                    id: string;
                };
                query?: {
                    directory: string;
                };
            }) => Promise<unknown>;
        };
    };
    sessionID: string;
    messageID?: string;
    directory: string;
}): Promise<boolean>;
