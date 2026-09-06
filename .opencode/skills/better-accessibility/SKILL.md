---
name: better-accessibility
description: Helps your project comply with accessibility standards and best practices.
---

# Accessibility

Most accessibility is free if you use the platform. Native elements ship with keyboard support, real labels announce themselves and a visible focus ring is one CSS rule.

Write every fix in the project's styling system, and use the exact values below rather than familiar-looking substitutes.

Reviewing means two walks. Keyboard-only, where every flow completes without a mouse. Then screen-reader, where every control announces a name, a role and its state. When unsure, take the platform default over a custom rebuild, and remove ARIA rather than add it.

Contrast measurement and color fixes belong to `better-colors`. Text sizing and iOS input zoom belong to `better-typography`. Spatial RTL layout belongs to `better-layout`.

## Native elements first

The first rule of ARIA: don't use ARIA when a native element exists. `<button>` for actions, `<a href>` for navigation, never `<div onClick>`. A real link must support Cmd/Ctrl/middle-click. No ARIA is better than bad ARIA. See [semantics-and-aria.md](semantics-and-aria.md) for landmarks, button-vs-link and disabled states.

## Visible focus rings

Style `:focus-visible`, not bare `:focus`. Keyboard users get a ring and mouse users usually don't. Prefer the browser's unmodified indicator.

A custom ring needs a project focus token or another explicit color. Verify the whole indicator against every adjacent color it crosses, `currentColor` included. Use at least a `2px` solid perimeter or an equivalent visible area. Never use `outline: none` without a verified replacement, and preserve system colors in forced-colors mode. Recipes are in [focus-and-keyboard.md](focus-and-keyboard.md).

## Full keyboard support

Every pointer interaction needs a keyboard path. Follow the ARIA APG patterns: Escape closes overlays, arrow keys move within composite widgets, Tab moves between widgets, Enter and Space activate.

Use only `tabindex="0"` to join the natural tab order and `tabindex="-1"` for programmatic focus. Positive values break that order. Composite widgets use roving tabindex, where the active item is `0` and every other is `-1`.

## Trap and restore focus

Modals set `inert` on the background content, move focus inside on open and return focus to the trigger on close. Add `overscroll-behavior: contain` so background content doesn't scroll.

## Minimum hit area

WCAG 2.5.8's Level AA baseline is a 24×24 CSS-pixel target, or one of its spacing, equivalent-control, inline, user-agent and essential exceptions. Aim for 44×44px on touch and 40×40px on desktop where density permits. Extend with a pseudo-element when the visible element should stay smaller.

Never let extended hit areas overlap. Give decorative layers `pointer-events: none`, so a glow never swallows the clicks meant for the control beneath it. Sizes and collision rules are in [hit-areas.md](hit-areas.md).

## Label and type every control

Every input gets a `<label for>` or a wrapping `<label>`. A placeholder is never a label. Label and control share one hit target, with no dead zone between a checkbox and its text.

Add `autocomplete` with a meaningful `name`, plus the `type` and `inputmode` that summon the right keyboard. Never block paste; users paste passwords and one-time codes. See [forms.md](forms.md).

## Errors that announce

Keep submit enabled until the request starts, then disable with a spinner and the original label. Validate on submit. Mark failing fields `aria-invalid="true"`, point `aria-describedby` at the inline error text and focus the first invalid field.

Use native `disabled` when a control is genuinely unavailable. Reach for `aria-disabled="true"` only when it should stay focusable, then block pointer, keyboard and form behavior in code and style the state explicitly.

## Accessible names everywhere

Icon-only buttons need a descriptive `aria-label`. Visible label text must appear in the accessible name. Decorative elements get `aria-hidden="true"`, never on a focusable element.

## Don't rely on color alone

Status needs a redundant cue: an icon, text, or an underline alongside the color. Work out which WCAG contrast requirement applies, then use `better-colors` to measure the rendered pair. When it fails, report the pair and the requirement it misses, and leave the colors alone unless asked.

## Honor prefers-reduced-motion

Wrap motion in `@media (prefers-reduced-motion: no-preference)` so it is opt-in. Under reduced motion, replace slides and scales with opacity crossfades, and kill parallax and autoplay entirely.

Two rules hold regardless of the preference. Autoplaying media needs a visible pause control, and toasts carrying an action or an error stay until dismissed. See [motion-and-zoom.md](motion-and-zoom.md).

## Announce dynamic content

Three mechanisms, three jobs. `aria-describedby` carries field-specific validation. A polite live region (`role="status"`) carries non-urgent updates not tied to a control, such as toasts and result counts. `role="alert"` carries urgent untied errors and nothing else.

Repeated polite announcements need a stable empty region rendered before its text updates. Dynamically inserted alerts vary in support, so test them on the screen readers you target. See [screen-readers.md](screen-readers.md).

## Alt text by purpose

Decorative images get `alt=""`. Informative images describe the meaning. Functional images describe the action: a search icon button is `alt="Search"`, not `alt="magnifying glass"`.

## Structure is navigation

Use headings that describe their sections and form a coherent outline. Give the page one `<h1>` and nest the levels below it without skipping. Expose one visible primary `<main>` landmark. When repeated navigation or chrome precedes it, make a "Skip to content" link the first focusable element. Anchored headings get `scroll-margin-top`.

## Survive zoom and text resize

The page must work at 200% zoom and reflow at 320px width without horizontal scrolling. Use `min-height` rather than fixed `height` on text containers. Prefer `rem` breakpoints where they fit the codebase, and never let the viewport meta cap how far the reader can zoom.

## Before you finish

| Mistake | Fix |
| --- | --- |
| Custom focus color assumed to work everywhere | Verify it against every adjacent color and in forced-colors mode |
| Repeated polite update inconsistently announced | Keep a stable empty status region and update its text |
| `assertive` live region for a routine toast | Use `polite`; reserve `assertive` for errors |
| `aria-hidden="true"` on a focusable element | Remove it or make the element non-focusable |
| Submit disabled until the form is valid | Keep it enabled; validate on submit and focus the first error |
| Hover treatment stuck after a tap on touch | Gate hover styling with `@media (hover: hover)` |
| Tooltip on a natively `disabled` control | Text beside it, or `aria-disabled` so it stays focusable |

## Reporting

**Severity.** `HIGH` prevents a task, hides content from assistive technology, or creates a systemic failure. `MEDIUM` makes an interaction meaningfully harder. `LOW` is isolated polish.

**Verification.** Without a browser: accessible names on every interactive element, keyboard handlers on non-native controls, focus styles, `prefers-reduced-motion` guards and form labels bound to their inputs. With one: tab the flow in order, read computed names and roles from the accessibility tree, confirm a visible focus indicator at every stop and run an automated audit. Report every check you could not run as `Not verified`.

**Format.** Group findings under the principle each violates, ordered by severity, one row per root cause listing every location it appears in:

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |

`Location` is `path/to/file:line`. `Why` names the principle and the user impact.

End with `Block` when any `HIGH` remains, `Approve` otherwise, leaving the rest in the table as work to do. Never `Approve` coverage you did not inspect. With nothing to report, state "No actionable accessibility findings" and report verification.
