export declare function createSystemTransformHandler(): (input: {
    sessionID?: string;
    model: {
        id: string;
        providerID: string;
        [key: string]: unknown;
    };
}, output: {
    system: string[];
}) => Promise<void>;
