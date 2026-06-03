import type { SetStoreFunction, Store } from "./store.js";
export type { ArrayFilterFn, DeepMutable, DeepReadonly, NotWrappable, Part, SetStoreFunction, SolidStore, Store, StoreNode, StorePathRange, StoreSetter } from "./store.js";
export declare const $RAW: unique symbol;
export declare function isWrappable(obj: any): boolean;
export declare function unwrap<T>(item: T): T;
export declare function setProperty(state: any, property: PropertyKey, value: any, force?: boolean): void;
export declare function updatePath(current: any, path: any[], traversed?: PropertyKey[]): void;
export declare function createStore<T>(state: T | Store<T>): [Store<T>, SetStoreFunction<T>];
export declare function createMutable<T>(state: T | Store<T>): T;
export declare function modifyMutable<T>(state: T, modifier: (state: T) => T): void;
type ReconcileOptions = {
    key?: string | null;
    merge?: boolean;
};
export declare function reconcile<T extends U, U extends object>(value: T, options?: ReconcileOptions): (state: U) => T;
export declare function produce<T>(fn: (state: T) => void): (state: T) => T;
export declare const DEV: undefined;
