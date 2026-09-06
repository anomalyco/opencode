# Hit areas

Target sizes, expanding hit areas without changing visual size and collision rules.

## Target sizes

Separate the conformance baseline from larger usability targets:

| Standard | Minimum |
| --- | --- |
| WCAG 2.5.8 (AA) | 24×24px, the hard floor |
| WCAG 2.5.5 (AAA) | 44×44px |
| Apple HIG | 44×44pt |
| Material Design | 48×48dp |

WCAG 2.5.8 Level AA requires a 24×24 CSS-pixel target or one of its exceptions. Treat 44px as the recommended touch target for primary controls and 40px as a useful desktop target where density permits. Smaller controls are not automatic failures. Check the spacing, equivalent-control, inline, user-agent and essential exceptions before reporting one.

Under the spacing exception, an undersized target passes when a 24px circle centered on its bounding box intersects no other target and no other undersized target's circle. In the simple case, 20px targets need a 4px gap.

The visible element can stay small; the hit area is what must be big. Anything that looks clickable must be clickable across its whole visual extent, with no dead zones. A checkbox and its label share one hit target.

## Expanding the hit area

Where the visible element is smaller, say a 20×20 checkbox, extend the hit area with a pseudo-element. Put it on the wrapping `<label>` or `<button>`, never on the `<input>`, because replaced elements don't render `::before`/`::after` reliably.

### CSS example

```css
/* Small checkbox with expanded 44px hit area, on the wrapping label */
.checkbox-label {
  position: relative;
  width: 20px;
  height: 20px;
}

.checkbox-label::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%; /* physical centering: direction-independent */
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
}
```

### Tailwind example

```tsx
<button className="relative size-5 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-1/2">
  <CheckIcon />
</button>
```

### Layout alternative

Where the element can afford real box size, skip the pseudo-element and let the box be the target. That hands the browser real geometry for scrolling and gestures:

```css
.icon-button {
  min-width: 44px;
  min-height: 44px;
  display: inline-grid;
  place-items: center;
}
```

## Collision rule

Where the extended hit area overlaps another interactive element, shrink the pseudo-element to the largest size that does not collide. Two interactive elements never have overlapping hit areas.

## Decorative layers

A decorative layer painted over interactive content absorbs every pointer event its box covers: a gradient scrim, a glow, a blurred sheen, a full-bleed `::after`. The control underneath looks live and does nothing, and no hit-area sizing fixes it.

Give each one `pointer-events: none` (Tailwind `pointer-events-none`) so events reach the control below, plus `aria-hidden="true"` to keep it out of the accessibility tree:

```css
.card-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
```

Keep pointer events on any layer the user is meant to hit: a modal scrim that dismisses on click is a control, not decoration.

## Touch behavior

- Add `touch-action: manipulation` to interactive elements to remove the double-tap-to-zoom delay on mobile.
- Set `touch-action: none` on a surface implementing its own pan, zoom, or drag gestures, so the browser stops claiming them for scrolling and pinch-zoom. Scope it to that surface; at page level it removes scrolling.
- Set `-webkit-tap-highlight-color` to match the design instead of the default gray flash.
- Put hover-only styling behind `@media (hover: hover)`. On touch, `:hover` latches after a tap and holds until the user taps elsewhere, so it reads as a stuck selected state. Tailwind 4's `hover:` variant already compiles under this query.
- Prefer generous targets and clear affordances over finicky interactions such as tiny drag handles and precise hover zones.
