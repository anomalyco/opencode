export interface InjectedPathsData {
    sessionID: string;
    injectedPaths: string[];
    updatedAt: number;
}
export declare function createInjectedPathsStorage(storageDir: string): {
    loadInjectedPaths: (sessionID: string) => Set<string>;
    saveInjectedPaths: (sessionID: string, paths: Set<string>) => void;
    clearInjectedPaths: (sessionID: string) => void;
};
