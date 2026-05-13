export declare namespace State {
    function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S;
    function dispose(key: string): Promise<void>;
}
