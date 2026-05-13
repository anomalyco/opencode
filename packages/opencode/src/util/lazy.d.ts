export declare function lazy<T>(fn: () => T): {
    (): T;
    reset: () => void;
};
