export declare function loadInjectedRules(sessionID: string): {
    contentHashes: Set<string>;
    realPaths: Set<string>;
};
export declare function saveInjectedRules(sessionID: string, data: {
    contentHashes: Set<string>;
    realPaths: Set<string>;
}): void;
export declare function clearInjectedRules(sessionID: string): void;
