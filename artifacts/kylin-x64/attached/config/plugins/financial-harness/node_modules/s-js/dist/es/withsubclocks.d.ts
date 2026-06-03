export interface S {
    root<T>(fn: (dispose: () => void) => T): T;
    <T>(fn: () => T): () => T;
    <T>(fn: (v: T) => T, seed: T): () => T;
    on<T>(ev: () => any, fn: () => T): () => T;
    on<T>(ev: () => any, fn: (v: T) => T, seed: T, onchanges?: boolean): () => T;
    data<T>(value: T): DataSignal<T>;
    value<T>(value: T, eq?: (a: T, b: T) => boolean): DataSignal<T>;
    freeze<T>(fn: () => T): T;
    sample<T>(fn: () => T): T;
    cleanup(fn: (final: boolean) => any): void;
    subclock(): <T>(fn: () => T) => T;
    subclock<T>(fn: () => T): T;
}
export interface DataSignal<T> {
    (): T;
    (val: T): T;
}
declare const S: S;
export default S;
