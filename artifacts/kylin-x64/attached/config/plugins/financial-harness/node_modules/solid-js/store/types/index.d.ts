export { $RAW, createStore, unwrap } from "./store.js";
export type { ArrayFilterFn, DeepMutable, DeepReadonly, NotWrappable, Part, SetStoreFunction, SolidStore, Store, StoreNode, StorePathRange, StoreSetter } from "./store.js";
export * from "./mutable.js";
export * from "./modifiers.js";
import { $NODE, isWrappable } from "./store.js";
export declare const DEV: {
    readonly $NODE: typeof $NODE;
    readonly isWrappable: typeof isWrappable;
    readonly hooks: {
        onStoreNodeUpdate: import("./store.js").OnStoreNodeUpdate | null;
    };
} | undefined;
