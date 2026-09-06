# Spacing and adaptivity

Space between controls, margins against the viewport, hints at off-screen content and layouts that survive resizing and translation.

## Breathing room between targets

Controls placed too close get mis-tapped and read as one unit. Where the project has no density scale, start here:

| Between | Starting point |
| --- | --- |
| Adjacent bordered/filled controls (buttons, inputs) | `12px` |
| Around borderless controls (text buttons, icon buttons) | `24px` |
| Unrelated control groups | `24px`+ (2× the intra-group gap) |

Borderless controls need more clearance, because nothing marks where one target ends and the next begins. The space is the boundary. Compact professional tools may use less where hit areas stay distinct and never overlap. Preserve an established, usable density rather than expanding controls to match these values.

```html
<!-- Good: bordered buttons at 12px, icon buttons given room -->
<div class="flex gap-3">
  <button class="rounded-lg border px-4 py-2">Cancel</button>
  <button class="rounded-lg bg-blue-600 px-4 py-2 text-white">Save</button>
</div>

<!-- Bad: three borderless icon buttons packed at 4px -->
<div class="flex gap-1">
  <button><TrashIcon /></button>
  <button><ArchiveIcon /></button>
  <button><ShareIcon /></button>
</div>
```

WCAG target-size requirements, larger usability targets and pseudo-element expansion belong to `better-accessibility`; these clearances are in addition, so expanded hit areas never overlap.

## Inset buttons from the edges

In content layouts, buttons pressed against the viewport look like system chrome and clip against curved corners or gesture zones. Keep them inside the layout margins. Edge-to-edge actions stay valid where they are deliberately platform chrome and account for safe areas:

```css
/* Good: inset action bar */
.action-bar {
  padding-inline: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
.action-bar button { width: 100%; border-radius: 12px; }

/* Bad: button glued to all three edges */
.action-bar button {
  width: 100vw;
  border-radius: 0;
  position: fixed;
  bottom: 0;
}
```

Start near `16px` inline margin on mobile where the project has no layout token. The button can still span the full content width inside them.

## Progressive disclosure needs an affordance

Hiding complexity is good; hiding it without a cue is a trap. Every piece of off-screen or collapsed content needs a visible hint that it exists. Keep the product's established scroll indicator or disclosure pattern, and use the recipes below only where no cue exists:

- **Peeking items.** In a horizontal scroller or carousel, size items so the next one peeks `16–32px` past the container edge. A row of cards that ends exactly at the edge looks complete, and nobody scrolls it.
- **Disclosure controls.** Collapsed sections get a chevron or "Show more", labelled with what is hidden: "Show 12 more results", not "More".
- **Truncation cues.** Clamped text shows an ellipsis and a way to expand. Truncation mechanics are `better-typography`'s.

In the peeking-scroller recipe, the container's padding creates the peek and snap points stay on the content edge.

```css
.scroller {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-inline: 24px;
  scroll-padding-inline: 24px;
  scroll-snap-type: x mandatory;
}
.scroller > * {
  flex: 0 0 calc(100% - 48px - 24px); /* container minus margins minus peek */
  scroll-snap-align: start;
}
```

```html
<!-- Tailwind: the 80% width keeps the next card's leading 16-32px visible -->
<div class="flex gap-3 overflow-x-auto px-6 [scroll-padding-inline:1.5rem] snap-x snap-mandatory">
  <div class="w-[80%] shrink-0 snap-start">…</div>
  <div class="w-[80%] shrink-0 snap-start">…</div>
</div>
```

## Content bleeds, controls float

The two layers behave differently at the edges:

- **Content layer**: backgrounds, hero media and scrollable lists extend to the viewport edges.
- **Control layer**: text and controls stay inside the layout margins and safe areas, floating above the content.

```css
/* Good: full-bleed media inside a constrained article */
.article {
  display: grid;
  grid-template-columns: 1fr min(65ch, calc(100% - 48px)) 1fr;
}
.article > * { grid-column: 2; }
.article > .full-bleed { grid-column: 1 / -1; }
```

Sticky headers and floating action buttons account for safe areas:

```css
.fab {
  position: fixed;
  inset-inline-end: calc(16px + env(safe-area-inset-right));
  bottom: calc(16px + env(safe-area-inset-bottom));
}
```

## Hold structure until it breaks

Breakpoints belong to the content, not the device catalog:

- Break where the layout actually stops fitting, not at `768px` because a preset says so. That is where the sidebar squeezes content below its minimum measure, or the card grid drops below a usable column width.
- Collapse late. A layout keeping its expanded structure as long as it genuinely fits stays stable and familiar. Premature collapsing throws away space users paid for.
- Prefer **container queries** for components. A card adapts to the column it is in, not to the viewport.

```css
/* Good: component adapts to its container */
.card-list { container-type: inline-size; }
@container (max-width: 400px) {
  .card { grid-template-columns: 1fr; }
}

/* Bad: viewport media query breaks the card inside a narrow sidebar */
@media (max-width: 768px) {
  .card { grid-template-columns: 1fr; }
}
```

Test the smallest and largest supported sizes first, since those break first, then the sizes between.

## Plan for growth and clipping

Layouts fail in two directions. Content grows, and viewports shrink.

**String expansion varies by language and by source-string length.** Never rely on one universal percentage.

- No fixed widths sized to English labels. Use `max-width` plus wrapping.
- No fixed heights on text containers. Use `min-height` where a floor is needed.
- Buttons size themselves from their label (`padding-inline`), never a hardcoded width.
- Test with pseudo-localization or a long-string locale before shipping.

```css
/* Good: label defines the size */
.button { padding-inline: 16px; white-space: nowrap; }

/* Bad: German will overflow or truncate */
.button { width: 96px; overflow: hidden; }
```

**Clipping.** Never park a critical action where it can be cut off: the bottom edge of a resizable pane, below the fold of a fixed-height modal, behind an expanding keyboard. Keep primary actions in stable chrome, a sticky footer with safe-area padding or the top of the view. Where a modal's content scrolls, its action row does not.
