import { createSignal } from "solid-js"

/**
 * The phone layout follows the input, not the width: a touch screen without hover, under 768px. A narrow desktop window
 * or browser tab on a mouse or trackpad keeps the desktop layout at any width.
 */
export const mobileLayoutQuery = "(hover: none) and (pointer: coarse) and (max-width: 767px)"

const media = globalThis.matchMedia?.(mobileLayoutQuery)

const [matches, setMatches] = createSignal(media?.matches ?? false)

media?.addEventListener("change", (event) => setMatches(event.matches))

/** Whether the app uses its phone layout. One query for the whole app, live as the window or input changes. */
export const isMobileLayout = matches
