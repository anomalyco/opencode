export interface S {
    root<T>(fn: (dispose: () => void) => T): T;
    <T>(fn: () => T): () => T;
    <T>(fn: (v: T) => T, seed: T): () => T;
    on<T>(ev: () => any, fn: () => T): () => T;
    on<T>(ev: () => any, fn: (v: T) => T, seed: T, onchanges?: boolean): () => T;
    effect<T>(fn: () => T): void;
    effect<T>(fn: (v: T) => T, seed: T): void;
    data<T>(value: T): DataSignal<T>;
    value<T>(value: T, eq?: (a: T, b: T) => boolean): DataSignal<T>;
    freeze<T>(fn: () => T): T;
    sample<T>(fn: () => T): T;
    cleanup(fn: (final: boolean) => any): void;
    isFrozen(): boolean;
    isListening(): boolean;
    makeDataNode<T>(value: T): IDataNode<T>;
    makeComputationNode<T>(fn: () => T): IComputationNode<T>;
    makeComputationNode<T>(fn: (val: T) => T, seed: T): IComputationNode<T>;
}
export interface DataSignal<T> {
    (): T;
    (val: T): T;
}
declare var S: S;
export default S;
export interface IDataNode<T> {
    clock(): IClock;
    current(): T;
    next(value: T): T;
}
export interface IComputationNode<T> {
    clock(): IClock;
    current(): T;
}
export interface IClock {
    time(): number;
}
