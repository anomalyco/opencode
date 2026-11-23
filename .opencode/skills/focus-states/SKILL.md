---
name: focus-states
description: Focus indicators and focus movement in OpenCode Desktop and the web app. Use when adding or reviewing an interactive component, a :focus/:focus-within/[data-focus-visible] rule, an outline on focus, a list/menu/palette row, a text field, a dialog, menu or popover, a selected state, removing or closing a focused item, or anything that moves focus programmatically.
---

# Focus States

Show one default ring while someone moves through the app with the keyboard, not when they click, tap or type. The app decides this itself, the same way in every browser.

## When the ring shows

`packages/ui/src/context/keyboard-mode.tsx` (installed in `AppBaseProviders` and in the story frame) keeps one keyboard mode for the window and marks the focused element with `data-focus-visible` while it is on. The rules are a pure state machine in `keyboard-mode-machine.ts`.

- On: Tab, an arrow key, Home or End moves focus to another element, or Enter, Space, an arrow key, Home or End is pressed on a focused control (a button, link, tab, menu item or another ARIA widget).
- Off: a pointer press.
- No change: typing, shortcuts held with Ctrl, Alt or Meta, lone modifier keys, Escape, keys in a text field or on a scroll region or panel, leaving and returning to the window, and focus the app moves itself (dialogs, menus, focus rescue, autofocus). Focus the app moves shows a ring only if the mode is already on.
- Settings › Appearance › "Always show focus rings" marks every focused element, a clicked one included.
- Never use `:focus-visible`, in CSS or in `matches()`. Chromium also matches it after any typed key, for every text field, and for script focus once a key was pressed, which showed rings at random. `base.css` removes the browser's own ring, and `bun run lint` fails on a new use (`script/check-focus-rings.ts`).
- Don't add ring logic to a component: no pointer or key tracking, no `focus({ focusVisible })`, no ring attribute of its own. The ring bookkeeping still in `field-focus.tsx`, `overlay-focus.tsx`, `dialog.tsx` and `focus-rescue.tsx` no longer affects what shows and is being removed.
- A custom control needs a widget role (`role="button"`, `role="tab"`, ...) for Enter and Space on it to count, which it needs for assistive technology anyway.

## The ring

- Style the ring on `[data-focus-visible]`, or with Tailwind's `focus-visible:`, `group-focus-visible:` and `peer-focus-visible:` variants, which the app redefines to that attribute. Don’t use `:focus` to decide whether to show it. `base.css` supplies `outline: 2px solid var(--v2-border-border-focus); outline-offset: 2px` and a 4px radius for links.
- Offset: `2px` outward by default. `-2px` inset for full-width rows and for controls flush against an edge that clips or scrolls (segmented items, split buttons, titlebar buttons, clear buttons). No other offsets.
- Follow the control’s radius; give a square text action or link 4px where appropriate. Use a wrapper with `:has(> trigger[data-focus-visible])` when the wrapper owns the visible shape or the trigger’s ring would clip, as with tabs and Settings project cards.
- Outline only. Don't draw focus with `box-shadow`: Windows High Contrast removes shadows, so the ring disappears, and shadow rings looked different from every other ring.
- Rings appear and disappear instantly. Draw no outline at rest and leave `outline-color` out of `transition`; animating it from the default colour flashes black. Don't use `outline: 2px solid transparent` at rest: High Contrast turns it into a visible outline on every control.
- Keep a border that identifies an unfocused control. Where Chromium's forced colours remove the shadow that draws a control's edge, give it a system-colour border in `@media (forced-colors: active)`, separate from the ring, as switches and radios do.
- Inline rename inputs rely on the caret and editing state. The timeline's Jump to latest stays in the Tab order with the shared ring, since it's the only quick way back down from the keyboard; its container is `inert` while it's hidden. Loading alone doesn’t add a ring. If a busy button keeps keyboard focus, keep the ring and show the busy state separately with `aria-busy`, a disabled state, or loading text; the ring alone doesn’t say whether the button can be activated.
- These ring rules do not replace normal field borders or validation feedback. Those can respond to click focus and have their own inset treatment.

## Text fields

- A click shows the field's normal focused border or background and the caret, with no ring. So does focus the app moves while the keyboard mode is off, such as the composer's autofocus when a session opens or typing that jumps to the composer.
- Tab into a field shows the ring. A field with a custom frame, like the composer and Home search, draws it on the frame with `:has(field[data-focus-visible])`.
- Moving a screen reader’s reading cursor alone does not move DOM focus.

## Rows

- Choose by how focus moves.
  - Focus stays in a search input while arrow keys move a highlight (`aria-activedescendant`: palettes, search lists): the active option is background-only and should not also be a Tab stop. Independent actions can still be Tab stops.
  - A full-width row that is its own Tab stop (Home sessions and projects, settings rows) gets a 2px inset ring. Standalone disclosure and tool triggers can use an outset ring if it fits. Hover stays background-only.
  - With roving focus (tabs and file trees), Tab enters the widget and arrow keys move focus within it. Show a ring on the keyboard-focused item, even though the other items are not separate Tab stops.
- The active option’s background highlight can disappear or become too faint in forced colours. Use `Highlight` and `HighlightText` in `@media (forced-colors: active)`. Check that nested labels and icons remain readable.
- Selection is not focus. Keep it neutral and distinct from the blue ring. The Settings › General layout cards (`settings/general/interface-mode.css`) are the reference for picker cards: a 2px `--v2-border-border-strong` border, a check badge outside the corner (`--v2-icon-icon-muted` fill, cut out in the surface colour, with a system-colour border in forced colours), and the other options' content faded. Don't use the inverse (black) border.

## Overlays and menus

- When an overlay closes and returns focus to its opener, the opener shows a ring only if the keyboard mode is on. A menu the pointer opened and Escape closed returns without one; a menu opened or navigated from the keyboard returns with one. Nothing in the overlay decides this.
- Dialogs return focus through the dialog context and dropdown menus through the `Menu` wrapper. Select, `Menu.Context`, and raw `@kobalte/core/popover` uses return it with `createOverlayFocus` in `packages/ui/src/context/overlay-focus.tsx`: call `openChanged` from `onOpenChange` and `restore(event, trigger)` from `onCloseAutoFocus`. Without a trigger, `restore(event)` returns to whatever had focus when it opened, such as a context menu's row.
- Choose the widget by what's inside, not by how it looks. A menu (`Menu`, `role="menu"`) holds only commands: arrow keys, Home/End and typeahead move, Enter chooses, Esc closes, and Tab does nothing, as in native menus. A popover that holds controls (switches, links, buttons in flyouts, like the Extensions panel) must let Tab move through them; arrow keys may be added on top.

## Clipping and covering

- Use `overflow: clip; overflow-clip-margin: 5px` only if the container does not need to scroll, including programmatic scrolling. For scrollers, use an inset ring, padding, or scroll margins as appropriate.
- Rows that overlap by a pixel to merge borders (accordions) let the next row paint over the bottom of an inset ring. Raise the header holding focus (`z-index`), as `accordion.css` and `sticky-accordion-header.css` do; with sticky headers, raise the header, not the item, or the item lands under its neighbours' sticky headers.
- Keep the whole ring clear of sticky content. Try an inset ring or a targeted `scroll-margin` on the affected items first. Use `scroll-padding` on the scroller only when sticky chrome covers focus across the whole area, since it changes every scroll, not just focus. Account for the header, any fade, and the ring’s reach (4px for the default outset ring). Check Tab and Shift+Tab.

## Colour and contrast

- Use `--v2-border-border-focus`, never a raw colour or a per-component override. It is Blue 500 in light and Blue 400 in dark; custom themes can override it.
- Light mode has a known contrast gap: Blue 500 is about 2.7:1 on white, below the 3:1 target. It was kept as a documented decision because Blue 600 read too heavy. It is not a pass, and 2.7:1 is not a new threshold.
- Measure against the actual adjacent colours in both schemes: the surrounding surface for an outset ring and the control’s fill for an inset ring. If contrast is low, first try a placement that improves it without clipping. If placement can’t fix it, flag the shortfall and revisit the token. Never change the colour per component.

## Order and movement

- Follow logical reading and interaction order, including in RTL. Fix DOM order rather than using positive `tabindex`. Use native buttons for actions and links for navigation; use established widget primitives or keyboard patterns for tabs, trees, sliders, and resize handles.
- Move focus in response to a user action or to recover focus when its target disappears. Background updates, streamed output, toasts, and incoming prompts must not steal focus.
- If a focused item is closed or deleted, move focus to the next place the user can continue the same task: the next or previous item in the same list, or a stable fallback such as the list heading or the control that opened it. Use the visually nearest control only when it serves that task. Don’t leave focus on `<body>`.
- Chromium drops focus to `<body>` without an event when the focused element is removed, disabled, or stops being editable. `packages/ui/src/context/focus-rescue.tsx` (installed in `AppBaseProviders`) recovers it inside a `data-focus-scope`: the next item, or the previous after the last, widening to the enclosing scope when the inner one is empty, and back to what had focus before when nothing is left. Mark a new list, strip, chip row or panel with `data-focus-scope` rather than adding per-feature focus code. Rescue never moves focus into a `role="tablist"`, because Kobalte tabs select themselves on focus, so don't mark a tab list as a scope. Items in an overlay leave the return to the overlay; rescue steps in only when the overlay's opener is gone too. Move focus explicitly when the task has a better target than the neighbour, such as the composer after the last chip.

## Verify

- A story is optional, for visual checks such as clipping, colour, and forced colours. Use one if the repo has a suitable focus story, or a local one you don't commit; don't add a case for every fix. Test focus order, removal and restoration in the app with real input, not in a story.
- Use real keyboard and pointer input for the behaviour you changed. Check Tab and Shift+Tab for order and clipping, arrow keys for composites, and shortcuts for programmatic focus. For overlay return, check keyboard open with Escape and pointer open with Escape. Forced focus shows appearance, not whether navigation or restoration works.
- In a test, `locator.focus()` alone shows no ring, because it is focus the app moved. Reach the control with Tab, or press Tab once first to start keyboard navigation. A lone Shift no longer does.
- Check light, dark, and forced colours when the indicator or its background changes. Report Chromium forced-colours emulation (DevTools → Rendering → `forced-colors: active`) separately from native Windows High Contrast or assistive-technology testing.
