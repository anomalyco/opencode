# Focus and keyboard

Focus rings, skip links, tabindex, focus trapping and the APG keyboard patterns.

## Focus rings

Style `:focus-visible`, not bare `:focus`. The browser shows it for keyboard and assistive-tech focus and suppresses it for mouse clicks, where focus is already obvious. Never write `outline: none` or `focus:outline-none` without a visible replacement, which removes keyboard navigation for sighted keyboard users.

Prefer the browser's unmodified focus indicator, which adapts to platform and forced-color settings without the author predicting every background. Adding only `outline-offset` preserves it. A custom `outline: 2px solid` with no color renders `currentColor`, which is not automatically accessible, because the outline may cross colors unlike the text's own background. The preference order:

```css
/* Best: keep the browser ring, just give it breathing room */
:focus-visible {
  outline-offset: 2px;
}

/* Custom ring when the design requires one: use the project's verified token */
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

```tsx
// Tailwind: use the project's focus token or established focus-ring utility
<button className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
  Save
</button>
```

A custom focus indicator must meet the applicable project or WCAG target for visible area and change of contrast. Inspect the whole perimeter against every adjacent color it crosses: component fills, page surfaces, images, gradients, hover and selected states. A token, brand color, or `currentColor` passes only when that rendered check does.

In `forced-colors: active` (Windows High Contrast), keep the default color adjustment or name a system color such as `Highlight`. `forced-color-adjust: none` freezes the authored color, so use it only where you have checked the control stays perceivable.

Group focus styles with `:focus-within` when a wrapper should light up while an inner input has focus (e.g. a search box with an icon inside the border).

## Skip link

Target `<main id="main">` and visually hide the link until focused:

```css
.skip-link {
  position: absolute;
  inset-inline-start: -999px;
}
.skip-link:focus {
  inset-inline-start: 16px;
  top: 16px;
}
```

```html
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header>…</header>
  <main id="main">…</main>
</body>
```

Give in-page anchor targets `scroll-margin-top`, such as `80px` under a sticky header, so the target isn't hidden when jumped to.

## tabindex rules

- `tabindex="0"`: adds an element to the natural tab order. Only for custom interactive elements that aren't natively focusable.
- `tabindex="-1"`: focusable via JavaScript only (`el.focus()`). Use for headings you move focus to, modal containers and roving-tabindex members.
- Positive `tabindex`: never. It hijacks the tab order for the whole page. Fix the DOM order instead.

### Roving tabindex

Composite widgets, meaning tabs, menus, toolbars and radio groups, occupy one Tab stop. The active item has `tabindex="0"`, all others `tabindex="-1"`, and arrow keys move both focus and the `0`:

```tsx
<div role="tablist">
  {tabs.map((tab, i) => (
    <button
      role="tab"
      tabIndex={i === activeIndex ? 0 : -1}
      aria-selected={i === activeIndex}
      onKeyDown={handleArrowKeys} // ArrowLeft/ArrowRight move activeIndex, wrapping
    >
      {tab.label}
    </button>
  ))}
</div>
```

## Focus trapping and restoration

Modals must trap focus. Put `inert` on everything behind the dialog, which removes background content from the tab order and from assistive tech in one move:

```tsx
// On open
document.getElementById("app-content").inert = true;
const dialog = dialogRef.current;
(dialog.querySelector("[autofocus]") ??
  dialog.querySelector("button, [href], input, select, textarea"))?.focus();

// On close
document.getElementById("app-content").inert = false;
triggerRef.current?.focus(); // always return focus to the element that opened it
```

Prefer native `<dialog>` with `showModal()`, which gives you the trap, the `inert` background and Escape handling for free. A custom overlay that can't use it needs `role="dialog"`, `aria-modal="true"` and an accessible name via `aria-labelledby`. Either way:

- On open, focus the first focusable element. For destructive confirmations, focus the least destructive action instead.
- On close, return focus to the trigger, or to the nearest logical container if the trigger is gone.
- Add `overscroll-behavior: contain` on the dialog so scrolling inside never scrolls the page behind it.

## Keyboard patterns (ARIA APG)

Native elements come with these behaviors; custom widgets must implement them. A role is a promise. Give something `role="tab"` and users expect the full tab keyboard model.

| Widget | Keys |
| --- | --- |
| Dialog | Tab/Shift+Tab cycle inside (wrap at ends); Escape closes |
| Tabs | Arrow keys move between tabs (wrapping); Tab exits to the panel; Home/End jump to first/last |
| Menu button | Enter/Space/ArrowDown opens and focuses first item; ArrowUp opens and focuses last; arrows navigate; Escape closes and refocuses the button |
| Disclosure / accordion | Header is a `<button aria-expanded>`; Enter and Space toggle |
| Combobox | ArrowDown opens/moves into the list; Enter accepts; Escape closes and returns to the input; typing filters |
| Listbox / radio group | Arrow keys move selection; one Tab stop for the whole group |

Universal rules:

- Escape dismisses whatever opened last: tooltip, then menu, then dialog.
- Arrow keys, not Tab, move within a composite widget; Tab moves between widgets.
- Tabs choose activation mode: automatic (panel switches on arrow focus) when panels render instantly, manual (Enter/Space to activate) when switching is expensive.
- Enter submits the focused input's form. In `<textarea>`, Enter inserts a newline and ⌘/Ctrl+Enter submits.

## SPA route changes

Client-side navigation doesn't reset focus or announce anything. On route change, update `document.title` to match the new context, then move focus to the new view's `<h1>` (given `tabindex="-1"`) or to `<main>`. Restore scroll position on back and forward navigation, and scroll to top on forward navigation.
