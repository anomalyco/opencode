import { hydrate as hydrateCore } from "./client.js";
import { JSX, ComponentProps, ValidComponent } from "solid-js";
export * from "./client.js";
export { For, Show, Suspense, SuspenseList, Switch, Match, Index, ErrorBoundary, mergeProps } from "solid-js";
export * from "./server-mock.js";
export declare const isServer: boolean;
export declare const isDev: boolean;
export declare const hydrate: typeof hydrateCore;
/**
 * Renders components somewhere else in the DOM
 *
 * Useful for inserting modals and tooltips outside of an cropping layout. If no mount point is given, the portal is inserted in document.body; it is wrapped in a `<div>` unless the target is document.head or `isSVG` is true. setting `useShadow` to true places the element in a shadow root to isolate styles.
 *
 * @description https://docs.solidjs.com/reference/components/portal
 */
export declare function Portal<T extends boolean = false, S extends boolean = false>(props: {
    mount?: Node;
    useShadow?: T;
    isSVG?: S;
    ref?: (S extends true ? SVGGElement : HTMLDivElement) | ((el: (T extends true ? {
        readonly shadowRoot: ShadowRoot;
    } : {}) & (S extends true ? SVGGElement : HTMLDivElement)) => void);
    children: JSX.Element;
}): Text;
export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
    [K in keyof P]: P[K];
} & {
    component: T | undefined;
};
/**
 * Renders an arbitrary component or element with the given props
 *
 * This is a lower level version of the `Dynamic` component, useful for
 * performance optimizations in libraries. Do not use this unless you know
 * what you are doing.
 * ```typescript
 * const element = () => multiline() ? 'textarea' : 'input';
 * createDynamic(element, { value: value() });
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export declare function createDynamic<T extends ValidComponent>(component: () => T | undefined, props: ComponentProps<T>): JSX.Element;
/**
 * Renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export declare function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element;
