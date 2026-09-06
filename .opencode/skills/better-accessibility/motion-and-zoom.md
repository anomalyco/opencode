# Motion and zoom

`prefers-reduced-motion`, zoom and reflow, and unit choices that respect user settings.

## prefers-reduced-motion

Make motion opt-in. Wrap animations in `@media (prefers-reduced-motion: no-preference)` so users who asked for reduced motion get the static version by default, rather than you chasing every animation with an override.

```css
/* Good: motion is opt-in */
.card {
  /* static styles */
}
@media (prefers-reduced-motion: no-preference) {
  .card {
    transition: transform 200ms ease-out;
  }
}
```

```tsx
// Tailwind: motion-safe / motion-reduce variants
<div className="motion-safe:transition-transform motion-safe:hover:-translate-y-1" />
```

For an existing codebase where opt-in isn't feasible, the global kill switch is the fallback:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`0.01ms` rather than `none`, so `animationend` and `transitionend` still fire and JS waiting on them doesn't hang.

### What to disable vs reduce

Reduced motion means reduced, not eliminated. It targets vestibular triggers, not feedback.

| Disable entirely | Replace | Keep |
| --- | --- | --- |
| Parallax scrolling | Slide/scale/zoom transitions → opacity crossfade | Loading spinners and progress |
| Autoplaying video, GIFs, looping decoration | Smooth scrolling → instant jump | Instant state changes (hover color, focus ring) |
| Spinning, large-scale movement across the screen | Auto-rotating carousels → start paused | Brief functional feedback (button press) |

Animations are interruptible and driven by user input. Nothing autoplays or refuses to stop, and under reduced motion carousels start paused.

## Autoplay and timed UI

Motion the user didn't ask for and UI acting on its own schedule:

- **No autoplaying media without visible controls** (WCAG 2.2.2). Anything moving, blinking, or updating on its own for more than 5 seconds needs a visible pause or stop control, muted looping hero videos included.
- **Prefer explicit dismissal over timers.** Auto-dismissal suits low-stakes confirmations and nothing else. A toast carrying an action, an error, or information the user may need stays until dismissed. Where one must time out, 5 seconds is the floor, and hovering or focusing it pauses the timer.
- **Never put critical information only in a timed element.** A vanished toast with the only link to an undo action is data loss on a schedule.

## Zoom and reflow

- **200% zoom** (WCAG 1.4.4). All content and functionality survives text scaled to 200%, and the viewport leaves the reader able to zoom.
- **Reflow at 320px** (WCAG 1.4.10). At 400% zoom on a 1280px viewport, equivalent to a 320px one, the page must work with vertical scrolling alone. Genuinely 2D content is the exception: tables, maps and code blocks scroll inside their own container.

Fixed heights are what break under zoom. Use `min-height` on anything containing text and let containers grow.

### rem vs px

Respect how the codebase is set up. Where the project sizes in `px`, or on an established Tailwind scale, stay consistent and never introduce mixed units into someone else's system. Where you do have the choice, in new code or a codebase already on `rem`, `rem` respects the user's base font size and `px` ignores it:

| Use `rem` | Use `px` |
| --- | --- |
| `font-size` | Borders and hairlines |
| `max-width` of text containers | Focus outline width and offset |
| Media-query breakpoints (`@media (min-width: 48rem)`) | `box-shadow` details |
| Spacing that should scale with text | Fixed-size decorations |

Breakpoints are where the choice matters most. At a larger base font size an `em` or `rem` query switches to the mobile layout when the text needs it, and a `px` query does not.
