export type SessionInjectedRulesCache = {
    contentHashes: Set<string>;
    realPaths: Set<string>;
};
export declare function createSessionCacheStore(): {
    getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
    clearSessionCache: (sessionID: string) => void;
};
