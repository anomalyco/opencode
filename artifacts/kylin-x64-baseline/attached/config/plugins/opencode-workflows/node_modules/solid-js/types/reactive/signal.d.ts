/**
The MIT License (MIT)

Copyright (c) 2017 Adam Haile

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { requestCallback } from "./scheduler.js";
import type { JSX } from "../jsx.js";
import type { FlowComponent } from "../render/index.js";
export declare const IS_DEV: string | boolean;
export declare const equalFn: <T>(a: T, b: T) => boolean;
export declare const $PROXY: unique symbol;
export declare const SUPPORTS_PROXY: boolean;
export declare const $TRACK: unique symbol;
export declare const $DEVCOMP: unique symbol;
export declare var Owner: Owner | null;
export declare let Transition: TransitionState | null;
/** Object storing callbacks for debugging during development */
export declare const DevHooks: {
    afterUpdate: (() => void) | null;
    afterCreateOwner: ((owner: Owner) => void) | null;
    /** @deprecated use `afterRegisterGraph` */
    afterCreateSignal: ((signal: SignalState<any>) => void) | null;
    afterRegisterGraph: ((sourceMapValue: SourceMapValue) => void) | null;
};
export type ComputationState = 0 | 1 | 2;
export interface SourceMapValue {
    value: unknown;
    name?: string;
    graph?: Owner;
}
export interface SignalState<T> extends SourceMapValue {
    value: T;
    observers: Computation<any>[] | null;
    observerSlots: number[] | null;
    tValue?: T;
    comparator?: (prev: T, next: T) => boolean;
    internal?: true;
}
export interface Owner {
    owned: Computation<any>[] | null;
    cleanups: (() => void)[] | null;
    owner: Owner | null;
    context: any | null;
    sourceMap?: SourceMapValue[];
    name?: string;
}
export interface Computation<Init, Next extends Init = Init> extends Owner {
    fn: EffectFunction<Init, Next>;
    state: ComputationState;
    tState?: ComputationState;
    sources: SignalState<Next>[] | null;
    sourceSlots: number[] | null;
    value?: Init;
    updatedAt: number | null;
    pure: boolean;
    user?: boolean;
    suspense?: SuspenseContextType;
}
export interface TransitionState {
    sources: Set<SignalState<any>>;
    effects: Computation<any>[];
    promises: Set<Promise<any>>;
    disposed: Set<Computation<any>>;
    queue: Set<Computation<any>>;
    scheduler?: (fn: () => void) => unknown;
    running: boolean;
    done?: Promise<void>;
    resolve?: () => void;
}
type ExternalSourceFactory = <Prev, Next extends Prev = Prev>(fn: EffectFunction<Prev, Next>, trigger: () => void) => ExternalSource;
export interface ExternalSource {
    track: EffectFunction<any, any>;
    dispose: () => void;
}
export type RootFunction<T> = (dispose: () => void) => T;
/**
 * Creates a new non-tracked reactive context that doesn't auto-dispose
 *
 * @param fn a function in which the reactive state is scoped
 * @param detachedOwner optional reactive context to bind the root to
 * @returns the output of `fn`.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/create-root
 */
export declare function createRoot<T>(fn: RootFunction<T>, detachedOwner?: typeof Owner): T;
export type Accessor<T> = () => T;
export type Setter<in out T> = {
    <U extends T>(...args: undefined extends T ? [] : [value: Exclude<U, Function> | ((prev: T) => U)]): undefined extends T ? undefined : U;
    <U extends T>(value: (prev: T) => U): U;
    <U extends T>(value: Exclude<U, Function>): U;
    <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};
export type Signal<T> = [get: Accessor<T>, set: Setter<T>];
export interface SignalOptions<T> extends MemoOptions<T> {
    internal?: boolean;
}
/**
 * Creates a simple reactive state with a getter and setter
 * ```typescript
 * const [state: Accessor<T>, setState: Setter<T>] = createSignal<T>(
 *  value: T,
 *  options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * )
 * ```
 * @param value initial value of the state; if empty, the state's type will automatically extended with undefined; otherwise you need to extend the type manually if you want setting to undefined not be an error
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns ```typescript
 * [state: Accessor<T>, setState: Setter<T>]
 * ```
 * * the Accessor is merely a function that returns the current value and registers each call to the reactive root
 * * the Setter is a function that allows directly setting or mutating the value:
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * setCount(count => count + 1);
 * ```
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-signal
 */
export declare function createSignal<T>(): Signal<T | undefined>;
export declare function createSignal<T>(value: T, options?: SignalOptions<T>): Signal<T>;
export interface BaseOptions {
    name?: string;
}
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];
export interface EffectOptions extends BaseOptions {
}
export type EffectFunction<Prev, Next extends Prev = Prev> = (v: Prev) => Next;
/**
 * Creates a reactive computation that runs immediately before render, mainly used to write to other reactive primitives
 * ```typescript
 * export function createComputed<Next, Init = Next>(
 *   fn: (v: Init | Next) => Next,
 *   value?: Init,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-computed
 */
export declare function createComputed<Next>(fn: EffectFunction<undefined | NoInfer<Next>, Next>): void;
export declare function createComputed<Next, Init = Next>(fn: EffectFunction<Init | Next, Next>, value: Init, options?: EffectOptions): void;
/**
 * Creates a reactive computation that runs during the render phase as DOM elements are created and updated but not necessarily connected
 * ```typescript
 * export function createRenderEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-render-effect
 */
export declare function createRenderEffect<Next>(fn: EffectFunction<undefined | NoInfer<Next>, Next>): void;
export declare function createRenderEffect<Next, Init = Next>(fn: EffectFunction<Init | Next, Next>, value: Init, options?: EffectOptions): void;
/**
 * Creates a reactive computation that runs after the render phase
 * ```typescript
 * export function createEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-effect
 */
export declare function createEffect<Next>(fn: EffectFunction<undefined | NoInfer<Next>, Next>): void;
export declare function createEffect<Next, Init = Next>(fn: EffectFunction<Init | Next, Next>, value: Init, options?: EffectOptions & {
    render?: boolean;
}): void;
/**
 * Creates a reactive computation that runs after the render phase with flexible tracking
 * ```typescript
 * export function createReaction(
 *   onInvalidate: () => void,
 *   options?: { name?: string }
 * ): (fn: () => void) => void;
 * ```
 * @param invalidated a function that is called when tracked function is invalidated.
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-reaction
 */
export declare function createReaction(onInvalidate: () => void, options?: EffectOptions): (tracking: () => void) => void;
export interface Memo<Prev, Next = Prev> extends SignalState<Next>, Computation<Next> {
    value: Next;
    tOwned?: Computation<Prev | Next, Next>[];
}
export interface MemoOptions<T> extends EffectOptions {
    equals?: false | ((prev: T, next: T) => boolean);
}
/**
 * Creates a readonly derived reactive memoized signal
 * ```typescript
 * export function createMemo<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes and use a custom comparison function in equals
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-memo
 */
export declare function createMemo<Next extends Prev, Prev = Next>(fn: EffectFunction<undefined | NoInfer<Prev>, Next>): Accessor<Next>;
export declare function createMemo<Next extends Prev, Init = Next, Prev = Next>(fn: EffectFunction<Init | Prev, Next>, value: Init, options?: MemoOptions<Next>): Accessor<Next>;
interface Unresolved {
    state: "unresolved";
    loading: false;
    error: undefined;
    latest: undefined;
    (): undefined;
}
interface Pending {
    state: "pending";
    loading: true;
    error: undefined;
    latest: undefined;
    (): undefined;
}
interface Ready<T> {
    state: "ready";
    loading: false;
    error: undefined;
    latest: T;
    (): T;
}
interface Refreshing<T> {
    state: "refreshing";
    loading: true;
    error: undefined;
    latest: T;
    (): T;
}
interface Errored {
    state: "errored";
    loading: false;
    error: any;
    latest: never;
    (): never;
}
export type Resource<T> = Unresolved | Pending | Ready<T> | Refreshing<T> | Errored;
export type InitializedResource<T> = Ready<T> | Refreshing<T> | Errored;
export type ResourceActions<T, R = unknown> = {
    mutate: Setter<T>;
    refetch: (info?: R) => T | Promise<T> | undefined | null;
};
export type ResourceSource<S> = S | false | null | undefined | (() => S | false | null | undefined);
export type ResourceFetcher<S, T, R = unknown> = (k: S, info: ResourceFetcherInfo<T, R>) => T | Promise<T>;
export type ResourceFetcherInfo<T, R = unknown> = {
    value: T | undefined;
    refetching: R | boolean;
};
export type ResourceOptions<T, S = unknown> = {
    initialValue?: T;
    name?: string;
    deferStream?: boolean;
    ssrLoadFrom?: "initial" | "server";
    storage?: (init: T | undefined) => [Accessor<T | undefined>, Setter<T | undefined>];
    onHydrated?: (k: S | undefined, info: {
        value: T | undefined;
    }) => void;
};
export type InitializedResourceOptions<T, S = unknown> = ResourceOptions<T, S> & {
    initialValue: T;
};
export type ResourceReturn<T, R = unknown> = [Resource<T>, ResourceActions<T | undefined, R>];
export type InitializedResourceReturn<T, R = unknown> = [
    InitializedResource<T>,
    ResourceActions<T, R>
];
/**
 * Creates a resource that wraps a repeated promise in a reactive pattern:
 * ```typescript
 * // Without source
 * const [resource, { mutate, refetch }] = createResource(fetcher, options);
 * // With source
 * const [resource, { mutate, refetch }] = createResource(source, fetcher, options);
 * ```
 * @param source - reactive data function which has its non-nullish and non-false values passed to the fetcher, optional
 * @param fetcher - function that receives the source (true if source not provided), the last or initial value, and whether the resource is being refetched, and returns a value or a Promise:
 * ```typescript
 * const fetcher: ResourceFetcher<S, T, R> = (
 *   sourceOutput: S,
 *   info: { value: T | undefined, refetching: R | boolean }
 * ) => T | Promise<T>;
 * ```
 * @param options - an optional object with the initialValue and the name (for debugging purposes); see {@link ResourceOptions}
 *
 * @returns ```typescript
 * [Resource<T>, { mutate: Setter<T>, refetch: () => void }]
 * ```
 *
 * * Setting an `initialValue` in the options will mean that both the prev() accessor and the resource should never return undefined (if that is wanted, you need to extend the type with undefined)
 * * `mutate` allows to manually overwrite the resource without calling the fetcher
 * * `refetch` will re-run the fetcher without changing the source, and if called with a value, that value will be passed to the fetcher via the `refetching` property on the fetcher's second parameter
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-resource
 */
export declare function createResource<T, R = unknown>(fetcher: ResourceFetcher<true, T, R>, options: InitializedResourceOptions<NoInfer<T>, true>): InitializedResourceReturn<T, R>;
export declare function createResource<T, R = unknown>(fetcher: ResourceFetcher<true, T, R>, options?: ResourceOptions<NoInfer<T>, true>): ResourceReturn<T, R>;
export declare function createResource<T, S, R = unknown>(source: ResourceSource<S>, fetcher: ResourceFetcher<S, T, R>, options: InitializedResourceOptions<NoInfer<T>, S>): InitializedResourceReturn<T, R>;
export declare function createResource<T, S, R = unknown>(source: ResourceSource<S>, fetcher: ResourceFetcher<S, T, R>, options?: ResourceOptions<NoInfer<T>, S>): ResourceReturn<T, R>;
export interface DeferredOptions<T> {
    equals?: false | ((prev: T, next: T) => boolean);
    name?: string;
    timeoutMs?: number;
}
/**
 * Creates a reactive computation that only runs and notifies the reactive context when the browser is idle
 * ```typescript
 * export function createDeferred<T>(
 *   fn: (v: T) => T,
 *   options?: { timeoutMs?: number, name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T);
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param options allows to set the timeout in milliseconds, use a custom comparison function and set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-deferred
 */
export declare function createDeferred<T>(source: Accessor<T>, options?: DeferredOptions<T>): Accessor<T>;
export type EqualityCheckerFunction<T, U> = (a: U, b: T) => boolean;
/**
 * Creates a conditional signal that only notifies subscribers when entering or exiting their key matching the value
 * ```typescript
 * export function createSelector<T, U>(
 *   source: () => T
 *   fn: (a: U, b: T) => boolean,
 *   options?: { name?: string }
 * ): (k: U) => boolean;
 * ```
 * @param source
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param options allows to set a name in dev mode for debugging purposes, optional
 *
 * ```typescript
 * const isSelected = createSelector(selectedId);
 * <For each={list()}>
 *   {(item) => <li classList={{ active: isSelected(item.id) }}>{item.name}</li>}
 * </For>
 * ```
 *
 * This makes the operation O(2) instead of O(n).
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-selector
 */
export declare function createSelector<T, U = T>(source: Accessor<T>, fn?: EqualityCheckerFunction<T, U>, options?: BaseOptions): (key: U) => boolean;
/**
 * Holds changes inside the block before the reactive context is updated
 * @param fn wraps the reactive updates that should be batched
 * @returns the return value from `fn`
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/batch
 */
export declare function batch<T>(fn: Accessor<T>): T;
/**
 * Ignores tracking context inside its scope
 * @param fn the scope that is out of the tracking context
 * @returns the return value of `fn`
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/untrack
 */
export declare function untrack<T>(fn: Accessor<T>): T;
/** @deprecated */
export type ReturnTypes<T> = T extends readonly Accessor<unknown>[] ? {
    [K in keyof T]: T[K] extends Accessor<infer I> ? I : never;
} : T extends Accessor<infer I> ? I : never;
export type AccessorArray<T> = [...Extract<{
    [K in keyof T]: Accessor<T[K]>;
}, readonly unknown[]>];
export type OnEffectFunction<S, Prev, Next extends Prev = Prev> = (input: S, prevInput: S | undefined, prev: Prev) => Next;
export interface OnOptions {
    defer?: boolean;
}
/**
 * Makes dependencies of a computation explicit
 * ```typescript
 * export function on<S, U>(
 *   deps: Accessor<S> | AccessorArray<S>,
 *   fn: (input: S, prevInput: S | undefined, prevValue: U | undefined) => U,
 *   options?: { defer?: boolean } = {}
 * ): (prevValue: U | undefined) => U;
 * ```
 * @param deps list of reactive dependencies or a single reactive dependency
 * @param fn computation on input; the current previous content(s) of input and the previous value are given as arguments and it returns a new value
 * @param options optional, allows deferred computation until at the end of the next change
 * @returns an effect function that is passed into createEffect. For example:
 *
 * ```typescript
 * createEffect(on(a, (v) => console.log(v, b())));
 *
 * // is equivalent to:
 * createEffect(() => {
 *   const v = a();
 *   untrack(() => console.log(v, b()));
 * });
 * ```
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/on-util
 */
export declare function on<S, Next extends Prev, Prev = Next>(deps: AccessorArray<S> | Accessor<S>, fn: OnEffectFunction<S, undefined | NoInfer<Prev>, Next>, options?: OnOptions & {
    defer?: false;
}): EffectFunction<undefined | NoInfer<Next>, NoInfer<Next>>;
export declare function on<S, Next extends Prev, Prev = Next>(deps: AccessorArray<S> | Accessor<S>, fn: OnEffectFunction<S, undefined | NoInfer<Prev>, Next>, options: OnOptions | {
    defer: true;
}): EffectFunction<undefined | NoInfer<Next>>;
/**
 * Runs an effect only after initial render on mount
 * @param fn an effect that should run only once on mount
 *
 * @description https://docs.solidjs.com/reference/lifecycle/on-mount
 */
export declare function onMount(fn: () => void): void;
/**
 * Runs an effect once before the reactive scope is disposed
 * @param fn an effect that should run only once on cleanup
 *
 * @returns the same {@link fn} function that was passed in
 *
 * @description https://docs.solidjs.com/reference/lifecycle/on-cleanup
 */
export declare function onCleanup<T extends () => any>(fn: T): T;
/**
 * Runs an effect whenever an error is thrown within the context of the child scopes
 * @param fn boundary for the error
 * @param handler an error handler that receives the error
 *
 * * If the error is thrown again inside the error handler, it will trigger the next available parent handler
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/catch-error
 */
export declare function catchError<T>(fn: () => T, handler: (err: Error) => void): T | undefined;
export declare function getListener(): Computation<any, any> | null;
export declare function getOwner(): Owner | null;
export declare function runWithOwner<T>(o: typeof Owner, fn: () => T): T | undefined;
export declare function enableScheduling(scheduler?: typeof requestCallback): void;
/**
 * ```typescript
 * export function startTransition(fn: () => void) => Promise<void>
 * ```
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/start-transition
 */
export declare function startTransition(fn: () => unknown): Promise<void>;
export type Transition = [Accessor<boolean>, (fn: () => void) => Promise<void>];
/**
 * ```typescript
 * export function useTransition(): [
 *   () => boolean,
 *   (fn: () => void, cb?: () => void) => void
 * ];
 * ```
 * @returns a tuple; first value is an accessor if the transition is pending and a callback to start the transition
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/use-transition
 */
export declare function useTransition(): Transition;
export declare function resumeEffects(e: Computation<any>[]): void;
export interface DevComponent<T> extends Memo<unknown> {
    props: T;
    name: string;
    component: (props: T) => unknown;
}
export declare function devComponent<P, V>(Comp: (props: P) => V, props: P): V;
export declare function registerGraph(value: SourceMapValue): void;
export type ContextProviderComponent<T> = FlowComponent<{
    value: T;
}>;
export interface Context<T> {
    id: symbol;
    Provider: ContextProviderComponent<T>;
    defaultValue: T;
}
/**
 * Creates a Context to handle a state scoped for the children of a component
 * ```typescript
 * interface Context<T> {
 *   id: symbol;
 *   Provider: FlowComponent<{ value: T }>;
 *   defaultValue: T;
 * }
 * export function createContext<T>(
 *   defaultValue?: T,
 *   options?: { name?: string }
 * ): Context<T | undefined>;
 * ```
 * @param defaultValue optional default to inject into context
 * @param options allows to set a name in dev mode for debugging purposes
 * @returns The context that contains the Provider Component and that can be used with `useContext`
 *
 * @description https://docs.solidjs.com/reference/component-apis/create-context
 */
export declare function createContext<T>(defaultValue?: undefined, options?: EffectOptions): Context<T | undefined>;
export declare function createContext<T>(defaultValue: T, options?: EffectOptions): Context<T>;
/**
 * Uses a context to receive a scoped state from a parent's Context.Provider
 *
 * @param context Context object made by `createContext`
 * @returns the current or `defaultValue`, if present
 *
 * @description https://docs.solidjs.com/reference/component-apis/use-context
 */
export declare function useContext<T>(context: Context<T>): T;
export type ResolvedJSXElement = Exclude<JSX.Element, JSX.ArrayElement>;
export type ResolvedChildren = ResolvedJSXElement | ResolvedJSXElement[];
export type ChildrenReturn = Accessor<ResolvedChildren> & {
    toArray: () => ResolvedJSXElement[];
};
/**
 * Resolves child elements to help interact with children
 *
 * @param fn an accessor for the children
 * @returns a accessor of the same children, but resolved
 *
 * @description https://docs.solidjs.com/reference/component-apis/children
 */
export declare function children(fn: Accessor<JSX.Element>): ChildrenReturn;
export type SuspenseContextType = {
    increment?: () => void;
    decrement?: () => void;
    inFallback?: () => boolean;
    effects?: Computation<any>[];
    resolved?: boolean;
};
type SuspenseContext = Context<SuspenseContextType | undefined> & {
    active?(): boolean;
    increment?(): void;
    decrement?(): void;
};
declare let SuspenseContext: SuspenseContext;
export declare function getSuspenseContext(): SuspenseContext;
export declare function enableExternalSource(factory: ExternalSourceFactory, untrack?: <V>(fn: () => V) => V): void;
export declare function readSignal(this: SignalState<any> | Memo<any>): any;
export declare function writeSignal(node: SignalState<any> | Memo<any>, value: any, isComp?: boolean): any;
/**
 * @deprecated since version 1.7.0 and will be removed in next major - use catchError instead
 * onError - run an effect whenever an error is thrown within the context of the child scopes
 * @param fn an error handler that receives the error
 *
 * * If the error is thrown again inside the error handler, it will trigger the next available parent handler
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/catch-error
 */
export declare function onError(fn: (err: Error) => void): void;
export {};
