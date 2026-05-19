import type { Sequence } from './sequence';
import type { Stream } from './stream';
type SpecialPromise = Promise<unknown> & {
    s?: 1 | 2;
    v?: unknown;
};
export interface PromiseConstructorResolver {
    p: SpecialPromise;
    s: (value: unknown) => void;
    f: (value: unknown) => void;
}
export declare const PROMISE_CONSTRUCTOR: () => PromiseConstructorResolver;
export declare const PROMISE_SUCCESS: (resolver: PromiseConstructorResolver, data: unknown) => void;
export declare const PROMISE_FAILURE: (resolver: PromiseConstructorResolver, data: unknown) => void;
export declare const SERIALIZED_PROMISE_CONSTRUCTOR: string;
export declare const SERIALIZED_PROMISE_SUCCESS: string;
export declare const SERIALIZED_PROMISE_FAILURE: string;
interface StreamListener<T> {
    next(value: T): void;
    throw(value: unknown): void;
    return(value: T): void;
}
export declare const STREAM_CONSTRUCTOR: () => {
    __SEROVAL_STREAM__: boolean;
    on: (listener: StreamListener<unknown>) => () => void;
    next: (value: unknown) => void;
    throw: (value: unknown) => void;
    return: (value: unknown) => void;
};
export declare const SERIALIZED_STREAM_CONSTRUCTOR: string;
export declare const ITERATOR_CONSTRUCTOR: (symbol: symbol) => (sequence: Sequence) => () => {
    [x: symbol]: () => /*elided*/ any;
    next: () => {
        done: boolean;
        value: unknown;
    };
};
export declare const SERIALIZED_ITERATOR_CONSTRUCTOR: string;
export declare const ASYNC_ITERATOR_CONSTRUCTOR: (symbol: symbol, createPromise: typeof PROMISE_CONSTRUCTOR) => (stream: Stream<unknown>) => () => {
    [x: symbol]: () => /*elided*/ any;
    next: () => SpecialPromise | {
        done: boolean;
        value: unknown;
    };
};
export declare const SERIALIZED_ASYNC_ITERATOR_CONSTRUCTOR: string;
export declare const ARRAY_BUFFER_CONSTRUCTOR: (b64: string) => ArrayBuffer;
export declare const SERIALIZED_ARRAY_BUFFER_CONSTRUCTOR: string;
export {};
//# sourceMappingURL=constructors.d.ts.map