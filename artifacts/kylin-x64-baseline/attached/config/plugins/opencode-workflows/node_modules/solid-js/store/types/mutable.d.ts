import { StoreNode } from "./store.js";
export declare function createMutable<T extends StoreNode>(state: T, options?: {
    name?: string;
}): T;
export declare function modifyMutable<T>(state: T, modifier: (state: T) => T): void;
