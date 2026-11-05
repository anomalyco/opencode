import type { ViewportBounds } from "../types.js";
interface ViewportObject {
    screenX: number;
    screenY: number;
    width: number;
    height: number;
    zIndex: number;
}
/**
 * Returns objects that overlap with the viewport bounds.
 *
 * @param viewport - The viewport bounds to check against
 * @param objects - Array of objects MUST be sorted by screen position (screenY for column, screenX for row direction)
 * @param direction - Primary scroll direction: "column" (vertical) or "row" (horizontal)
 * @param padding - Extra padding around viewport to include nearby objects
 * @param minTriggerSize - Minimum array size to use binary search optimization
 * @returns Array of visible objects sorted by zIndex
 *
 * @remarks
 * Objects must be pre-sorted by their start screen position (screenY for column direction, screenX for row direction).
 * Unsorted input will produce incorrect results.
 */
export declare function getObjectsInViewport<T extends ViewportObject>(viewport: ViewportBounds, objects: T[], direction?: "row" | "column", padding?: number, minTriggerSize?: number): T[];
export {};
