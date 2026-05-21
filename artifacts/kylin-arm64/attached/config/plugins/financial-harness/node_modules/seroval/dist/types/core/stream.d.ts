export interface StreamListener<T> {
    next(value: T): void;
    throw(value: unknown): void;
    return(value: T): void;
}
export interface Stream<T> {
    __SEROVAL_STREAM__: true;
    on(listener: StreamListener<T>): () => void;
    next(value: T): void;
    throw(value: unknown): void;
    return(value: T): void;
}
export declare function isStream<T>(value: object): value is Stream<T>;
export declare function createStream<T>(): Stream<T>;
export declare function createStreamFromAsyncIterable<T>(iterable: AsyncIterable<T>): Stream<T>;
export declare function streamToAsyncIterable<T>(stream: Stream<T>): () => AsyncIterableIterator<T>;
//# sourceMappingURL=stream.d.ts.map