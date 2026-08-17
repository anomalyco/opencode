import { createSignal } from "solid-js"

// Mount point for the vertical tab rail.
//
// The tab strip's controller state (current tab, draft creation, reorder,
// close, keyboard shortcuts) all lives inside titlebar.tsx's v2 branch, but the
// titlebar itself is a fixed 36px row (`h-9` plus a hard `min-height`), so a
// full-height rail cannot be a DOM child of it.
//
// Rather than hoist that state into a new context — which would mean
// duplicating route→tab matching and re-registering commands elsewhere — the
// layout publishes an empty slot element here and the titlebar portals the
// strip into it. The strip keeps its existing owner and reactivity; only its
// DOM position moves. A portal (not `position: absolute`) is what lets the rail
// participate in layout so `<main>` reflows beside it instead of being covered.
const [railMount, setRailMount] = createSignal<HTMLElement | undefined>()

export { railMount, setRailMount }
