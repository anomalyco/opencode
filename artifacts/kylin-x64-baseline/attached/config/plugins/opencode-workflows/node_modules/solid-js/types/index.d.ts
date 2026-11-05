export { $DEVCOMP, $PROXY, $TRACK, batch, catchError, children, createComputed, createContext, createDeferred, createEffect, createMemo, createReaction, createRenderEffect, createResource, createRoot, createSelector, createSignal, enableExternalSource, enableScheduling, equalFn, getListener, getOwner, on, onCleanup, onError, onMount, runWithOwner, startTransition, untrack, useContext, useTransition } from "./reactive/signal.js";
export type { Accessor, AccessorArray, ChildrenReturn, Context, ContextProviderComponent, EffectFunction, EffectOptions, InitializedResource, InitializedResourceOptions, InitializedResourceReturn, MemoOptions, NoInfer, OnEffectFunction, OnOptions, Owner, ResolvedChildren, ResolvedJSXElement, Resource, ResourceActions, ResourceFetcher, ResourceFetcherInfo, ResourceOptions, ResourceReturn, ResourceSource, ReturnTypes, Setter, Signal, SignalOptions, Transition } from "./reactive/signal.js";
export * from "./reactive/observable.js";
export * from "./reactive/scheduler.js";
export * from "./reactive/array.js";
export * from "./render/index.js";
import type { JSX } from "./jsx.js";
type JSXElement = JSX.Element;
export type { JSXElement, JSX };
import { registerGraph, writeSignal } from "./reactive/signal.js";
export declare const DEV: {
    readonly hooks: {
        afterUpdate: (() => void) | null;
        afterCreateOwner: ((owner: import("./reactive/signal.js").Owner) => void) | null;
        afterCreateSignal: ((signal: import("./reactive/signal.js").SignalState<any>) => void) | null;
        afterRegisterGraph: ((sourceMapValue: import("./reactive/signal.js").SourceMapValue) => void) | null;
    };
    readonly writeSignal: typeof writeSignal;
    readonly registerGraph: typeof registerGraph;
} | undefined;
declare global {
    var Solid$$: boolean;
}
