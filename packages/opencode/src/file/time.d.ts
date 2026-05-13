export declare namespace FileTime {
    const state: () => {
        read: {
            [sessionID: string]: {
                [path: string]: Date | undefined;
            };
        };
        locks: Map<string, Promise<void>>;
    };
    function read(sessionID: string, file: string): void;
    function get(sessionID: string, file: string): Date | undefined;
    function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T>;
    function assert(sessionID: string, filepath: string): Promise<void>;
}
