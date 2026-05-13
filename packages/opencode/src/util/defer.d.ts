export declare function defer<T extends () => void | Promise<void>>(fn: T): T extends () => Promise<void> ? {
    [Symbol.asyncDispose]: () => Promise<void>;
} : {
    [Symbol.dispose]: () => void;
};
