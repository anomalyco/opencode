# Animations

Interruptible transitions, press feedback and the restraint that decides whether to animate at all. Staged entrances and exits live in [enter-exit.md](enter-exit.md); icon swaps in [icon-transitions.md](icon-transitions.md).

## Interruptible animations

Users change intent mid-interaction. Animations that cannot be interrupted make the interface feel broken.

### CSS transitions vs. keyframes

| | CSS Transitions | CSS Keyframe Animations |
| --- | --- | --- |
| **Behavior** | Interpolate toward latest state | Run on a fixed timeline |
| **Interruptible** | Yes, retargets mid-animation | No, restarts from beginning |
| **Use for** | Interactive state changes (hover, toggle, open/close) | Staged sequences that run once (enter animations, loading) |
| **Duration** | Fixed; retargets the value mid-flight, not the timeline | Fixed timeline, restarts from the beginning |

```css
/* Good: interruptible transition for a toggle */
.drawer {
  transform: translateX(-100%);
  transition: transform 200ms ease-out;
}
.drawer.open {
  transform: translateX(0);
}

/* Clicking again mid-animation smoothly reverses, no jank */
```

```css
/* Bad: keyframe animation for interactive element */
.drawer.open {
  animation: slideIn 200ms ease-out forwards;
}

/* Closing mid-animation snaps or restarts, feels broken */
```

Prefer CSS transitions for interactive elements. Reserve keyframes for one-shot sequences.

## Scale on press

A subtle scale-down on click gives buttons tactile feedback. Always `scale(0.96)`, never below `0.95`, which feels exaggerated. Use CSS transitions so a release mid-press returns smoothly.

Not every button needs it. Add a `static` prop that disables the scale where the motion would distract.

### CSS example

```css
.button {
  transition-property: scale;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}

.button:active {
  scale: 0.96;
}
```

### Tailwind example

```tsx
<button className="transition-transform duration-150 ease-out active:scale-[0.96]">
  Click me
</button>
```

### Motion example

```tsx
<motion.button whileTap={{ scale: 0.96 }}>
  Click me
</motion.button>
```

### Static prop pattern

Extract the scale class into a variable and apply it conditionally on a `static` prop:

```tsx
const tapScale = "active:not-disabled:scale-[0.96]";

function Button({ static: isStatic, className, children, ...props }) {
  return (
    <button
      className={cn(
        "transition-transform duration-150 ease-out",
        !isStatic && tapScale,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Usage
<Button>Click me</Button>           {/* scales on press */}
<Button static>Submit</Button>       {/* no scale */}
```

## Skip animation on page load

Use `initial={false}` on `AnimatePresence` to stop enter animations firing on first render. An element already in its default state animates on later state changes, not on page load.

### When it works

```tsx
// Good: icon doesn't animate in on mount, only on state change
<AnimatePresence initial={false} mode="popLayout">
  <motion.span
    key={isActive ? "active" : "inactive"}
    initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
    exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
  >
    <Icon />
  </motion.span>
</AnimatePresence>
```

Works well for icon swaps, toggles, tabs and segmented controls, anything with a default state on page load.

### When it breaks

Never use `initial={false}` where the component relies on its `initial` prop for a first-time enter animation, such as a staggered page hero or a loading state. Removing it skips the entire entrance.

```tsx
// Bad: initial={false} would skip the staggered page enter entirely
<AnimatePresence initial={false}>
  <motion.div initial="hidden" animate="visible" variants={...}>
    ...
  </motion.div>
</AnimatePresence>
```

Verify the component still looks right on a full page refresh before applying this.

## Suppress transitions on theme switch

Flipping the theme changes `color`, `background-color`, `border-color` and `box-shadow` on nearly every element at once. Everything carrying a transition on those properties animates together, so the switch reads as a slow smear rather than an instant change. Disable transitions for the swap and restore them right after.

Inject a stylesheet that turns off every transition, force a reflow so the new colors commit while it still applies, then drop it on the next frame:

```tsx
"use client";

import { useEffect } from "react";

export function DisableThemeTransitions() {
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      const style = document.createElement("style");
      style.append(
        document.createTextNode(
          "*,*::before,*::after{transition:none !important}"
        )
      );
      document.head.append(style);

      const _flushReflow = document.body.offsetHeight;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => style.remove());
      });
    };

    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return null;
}
```

`document.body.offsetHeight` is read for its side effect, forcing a synchronous style flush so the new theme resolves while the override is still in the document and no transition starts. The nested `requestAnimationFrame` removes the override only after that paint, restoring transitions before the next interaction.

That covers the OS-level change. An in-app toggle needs the same treatment around its own flip: apply the override, change the theme, flush, remove. `next-themes` ships this as `disableTransitionOnChange`.

## Motion restraint

Motion is a budget, not a garnish. Three rules decide whether an animation belongs at all:

- **Give high-frequency interactions instant feedback instead of animation.** Every keystroke, every list-row hover, every tab switch in a work tool. Reserve expressive motion for infrequent moments (first load of a view, success states, empty states); high-frequency interactions get instant feedback or the subtlest possible transition (`opacity`/`background-color` at ≤150ms).
- **Motion is never the only feedback channel.** Every state change an animation communicates stays visible when it doesn't run: a color change, an icon swap, a label. Users with reduced motion enabled and anyone who blinked still need to see what happened.
- **Brief and precise beats prominent.** Where a shorter, smaller animation says the same thing, use it. When in doubt cut the duration, not the clarity.

```css
/* Good: high-frequency hover gets a minimal transition */
.row:hover {
  background-color: var(--surface-hover);
  transition: background-color 100ms ease-out;
}

/* Bad: every hover replays a full entrance */
.row:hover .row-icon {
  animation: bounceIn 500ms;
}
```

