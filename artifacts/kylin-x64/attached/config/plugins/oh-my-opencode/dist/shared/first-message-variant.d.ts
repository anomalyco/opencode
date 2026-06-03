type SessionInfo = {
    id?: string;
    parentID?: string;
};
export declare function createFirstMessageVariantGate(): {
    markSessionCreated(info?: SessionInfo): void;
    shouldOverride(sessionID?: string): boolean;
    markApplied(sessionID?: string): void;
    clear(sessionID?: string): void;
};
export {};
