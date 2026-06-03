import { Accessor, Setter, Signal } from "./reactive.js";
import type { JSX } from "../jsx.js";
export type Component<P = {}> = (props: P) => JSX.Element;
export type VoidProps<P = {}> = P & {
    children?: never;
};
export type VoidComponent<P = {}> = Component<VoidProps<P>>;
export type ParentProps<P = {}> = P & {
    children?: JSX.Element;
};
export type ParentComponent<P = {}> = Component<ParentProps<P>>;
export type FlowProps<P = {}, C = JSX.Element> = P & {
    children: C;
};
export type FlowComponent<P = {}, C = JSX.Element> = Component<FlowProps<P, C>>;
export type Ref<T> = T | ((val: T) => void);
export type ValidComponent = keyof JSX.IntrinsicElements | Component<any> | (string & {});
export type ComponentProps<T extends ValidComponent> = T extends Component<infer P> ? P : T extends keyof JSX.IntrinsicElements ? JSX.IntrinsicElements[T] : Record<string, unknown>;
type SharedConfig = {
    context?: HydrationContext;
    getContextId(): string;
    getNextContextId(): string;
};
export declare const sharedConfig: SharedConfig;
export declare function createUniqueId(): string;
export declare function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element;
export declare function mergeProps<T, U>(source: T, source1: U): T & U;
export declare function mergeProps<T, U, V>(source: T, source1: U, source2: V): T & U & V;
export declare function mergeProps<T, U, V, W>(source: T, source1: U, source2: V, source3: W): T & U & V & W;
export declare function splitProps<T extends object, K1 extends keyof T>(props: T, ...keys: [K1[]]): [Pick<T, K1>, Omit<T, K1>];
export declare function splitProps<T extends object, K1 extends keyof T, K2 extends keyof T>(props: T, ...keys: [K1[], K2[]]): [Pick<T, K1>, Pick<T, K2>, Omit<T, K1 | K2>];
export declare function splitProps<T extends object, K1 extends keyof T, K2 extends keyof T, K3 extends keyof T>(props: T, ...keys: [K1[], K2[], K3[]]): [Pick<T, K1>, Pick<T, K2>, Pick<T, K3>, Omit<T, K1 | K2 | K3>];
export declare function splitProps<T extends object, K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T>(props: T, ...keys: [K1[], K2[], K3[], K4[]]): [Pick<T, K1>, Pick<T, K2>, Pick<T, K3>, Pick<T, K4>, Omit<T, K1 | K2 | K3 | K4>];
export declare function splitProps<T extends object, K1 extends keyof T, K2 extends keyof T, K3 extends keyof T, K4 extends keyof T, K5 extends keyof T>(props: T, ...keys: [K1[], K2[], K3[], K4[], K5[]]): [
    Pick<T, K1>,
    Pick<T, K2>,
    Pick<T, K3>,
    Pick<T, K4>,
    Pick<T, K5>,
    Omit<T, K1 | K2 | K3 | K4 | K5>
];
export declare function For<T>(props: {
    each: T[];
    fallback?: string;
    children: (item: T, index: () => number) => string;
}): string | any[] | undefined;
export declare function Index<T>(props: {
    each: T[];
    fallback?: string;
    children: (item: () => T, index: number) => string;
}): string | any[] | undefined;
/**
 * Conditionally render its children or an optional fallback component
 * @description https://docs.solidjs.com/reference/components/show
 */
export declare function Show<T>(props: {
    when: T | undefined | null | false;
    keyed?: boolean;
    fallback?: string;
    children: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
}): string;
export declare function Switch(props: {
    fallback?: string;
    children: MatchProps<unknown> | MatchProps<unknown>[];
}): string;
type MatchProps<T> = {
    when: T | false;
    keyed?: boolean;
    children: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
};
export declare function Match<T>(props: MatchProps<T>): MatchProps<T>;
export declare function resetErrorBoundaries(): void;
export declare function ErrorBoundary(props: {
    fallback: string | ((err: any, reset: () => void) => string);
    children: string;
}): string | ((err: any, reset: () => void) => string) | {
    t: string;
};
export interface Resource<T> {
    (): T | undefined;
    state: "unresolved" | "pending" | "ready" | "refreshing" | "errored";
    loading: boolean;
    error: any;
    latest: T | undefined;
}
type SuspenseContextType = {
    resources: Map<string, {
        _loading: boolean;
        error: any;
    }>;
    completed: () => void;
};
export type ResourceActions<T> = {
    mutate: Setter<T>;
    refetch: (info?: unknown) => void;
};
export type ResourceReturn<T> = [Resource<T>, ResourceActions<T>];
export type ResourceSource<S> = S | false | null | undefined | (() => S | false | null | undefined);
export type ResourceFetcher<S, T> = (k: S, info: ResourceFetcherInfo<T>) => T | Promise<T>;
export type ResourceFetcherInfo<T> = {
    value: T | undefined;
    refetching?: unknown;
};
export type ResourceOptions<T> = undefined extends T ? {
    initialValue?: T;
    name?: string;
    deferStream?: boolean;
    ssrLoadFrom?: "initial" | "server";
    storage?: () => Signal<T | undefined>;
    onHydrated?: <S, T>(k: S, info: ResourceFetcherInfo<T>) => void;
} : {
    initialValue: T;
    name?: string;
    deferStream?: boolean;
    ssrLoadFrom?: "initial" | "server";
    storage?: (v?: T) => Signal<T | undefined>;
    onHydrated?: <S, T>(k: S, info: ResourceFetcherInfo<T>) => void;
};
export declare function createResource<T, S = true>(fetcher: ResourceFetcher<S, T>, options?: ResourceOptions<undefined>): ResourceReturn<T | undefined>;
export declare function createResource<T, S = true>(fetcher: ResourceFetcher<S, T>, options: ResourceOptions<T>): ResourceReturn<T>;
export declare function createResource<T, S>(source: ResourceSource<S>, fetcher: ResourceFetcher<S, T>, options?: ResourceOptions<undefined>): ResourceReturn<T | undefined>;
export declare function createResource<T, S>(source: ResourceSource<S>, fetcher: ResourceFetcher<S, T>, options: ResourceOptions<T>): ResourceReturn<T>;
export declare function lazy<T extends Component<any>>(fn: () => Promise<{
    default: T;
}>): T & {
    preload: () => Promise<{
        default: T;
    }>;
};
export declare function enableScheduling(): void;
export declare function enableHydration(): void;
export declare function startTransition(fn: () => any): void;
export declare function useTransition(): [() => boolean, (fn: () => any) => void];
type HydrationContext = {
    id: string;
    count: number;
    serialize: (id: string, v: Promise<any> | any, deferStream?: boolean) => void;
    nextRoot: (v: any) => string;
    replace: (id: string, replacement: () => any) => void;
    block: (p: Promise<any>) => void;
    resources: Record<string, any>;
    suspense: Record<string, SuspenseContextType>;
    registerFragment: (v: string) => (v?: string, err?: any) => boolean;
    lazy: Record<string, Promise<any>>;
    async?: boolean;
    noHydrate: boolean;
};
export declare function SuspenseList(props: {
    children: string;
    revealOrder: "forwards" | "backwards" | "together";
    tail?: "collapsed" | "hidden";
}): string;
export declare function Suspense(props: {
    fallback?: string;
    children: string;
}): string | number | boolean | Node | JSX.ArrayElement | {
    t: string;
} | null | undefined;
export {};
