import type { JSX } from "../jsx.js";
/**
 * **[experimental]** Controls the order in which suspended content is rendered
 *
 * @description https://docs.solidjs.com/reference/components/suspense-list
 */
export declare function SuspenseList(props: {
    children: JSX.Element;
    revealOrder: "forwards" | "backwards" | "together";
    tail?: "collapsed" | "hidden";
}): JSX.Element;
/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * ```typescript
 * const AsyncComponent = lazy(() => import('./component'));
 *
 * <Suspense fallback={<LoadingIndicator />}>
 *   <AsyncComponent />
 * </Suspense>
 * ```
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export declare function Suspense(props: {
    fallback?: JSX.Element;
    children: JSX.Element;
}): JSX.Element;
