# The picker

The control that switches variants. Its appearance is not a design decision, because it sits on top of the thing being judged. Build the spec below and leave it alone.

## Deliberately outside the design system

Never style the picker with the project's tokens, fonts, or colors. One that looks native to the product becomes part of what you are looking at, and then you are judging the harness.

One dark neutral surface, the system font stack and no project variables. Dark reads as chrome over both light and dark pages, which is why it does not follow the theme.

## Behavior

- It sets a `variant` search param and reads the active variant back from it, so the URL is the source of truth and every variant a link.
- Left and right arrows step through the set. Number keys jump to one directly.
- The active item carries `aria-current="true"`, and the container carries a label.
- Switching is instant. Flipping is the run's highest-frequency action, so `better-ui`'s motion restraint gives it no transition.
- It survives a resize, so you can hold a variant and drag the window rather than reloading per width.

## Structure

One button per variant, in the order they were named. Add a replay button only where a variant has an entrance worth re-triggering.

```html
<nav class="variant-picker" aria-label="Variants">
  <button type="button" data-variant="quiet" aria-current="true">Quiet</button>
  <button type="button" data-variant="editorial">Editorial</button>
  <button type="button" data-variant="dense">Dense</button>
</nav>
```

## Placement and styling

Fixed, bottom centre, above everything the page can stack. Keep it clear of the piece under judgement. Where the variants live at the bottom of the viewport, move the picker to top centre and say so.

```css
.variant-picker {
  position: fixed;
  bottom: 24px;
  left: 50%;
  translate: -50% 0;
  z-index: 2147483647;
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: rgb(20 20 20 / 0.9);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 24px rgb(0 0 0 / 0.25);
  font: 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  user-select: none;
}

.variant-picker button {
  padding: 7px 14px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: rgb(255 255 255 / 0.6);
  cursor: pointer;
}

.variant-picker button:hover {
  color: rgb(255 255 255 / 0.85);
}

.variant-picker button[aria-current="true"] {
  background: rgb(255 255 255 / 0.14);
  color: rgb(255 255 255);
}

.variant-picker button:focus-visible {
  outline: 2px solid rgb(255 255 255 / 0.7);
  outline-offset: 2px;
}
```

In a framework, keep the class names and the structure and change only the rendering syntax.
