# Icon transitions

Cross-fading an icon when it changes contextually or by state, with and without a motion library. Icon weight, color and direction live in [icons.md](icons.md).

## Contextual icon animations

When icons appear or disappear contextually, on hover or a state change, animate them with `opacity`, `scale` and `blur` rather than toggling visibility.

### Motion example

This uses the `motion` package. Where the project has `framer-motion`, import the same APIs from `"framer-motion"`. Never mix an installed package with the other's import path.

```tsx
import { AnimatePresence, motion } from "motion/react";

function IconButton({ isActive, icon: Icon }) {
  return (
    <button>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={isActive ? "active" : "inactive"}
          initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        >
          <Icon />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
```

### CSS transition approach (no Motion)

Without Motion or Framer Motion, keep both icons in the DOM and cross-fade with CSS transitions. Neither unmounts, so enter and exit both animate smoothly.

One icon is absolutely positioned on top of the other. Toggling state cross-fades them, the entering icon scaling up from `0.25` while the exiting one scales down to `0.25`, both with opacity and blur.

```tsx
function IconButton({ isActive, ActiveIcon, InactiveIcon }) {
  return (
    <button>
      <div className="relative">
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "transition-[opacity,filter,scale] duration-300",
            "ease-[cubic-bezier(0.2,0,0,1)]",
            isActive
              ? "scale-100 opacity-100 blur-0"
              : "scale-[0.25] opacity-0 blur-[4px]"
          )}
        >
          <ActiveIcon />
        </div>
        <div
          className={cn(
            "transition-[opacity,filter,scale] duration-300",
            "ease-[cubic-bezier(0.2,0,0,1)]",
            isActive
              ? "scale-[0.25] opacity-0 blur-[4px]"
              : "scale-100 opacity-100 blur-0"
          )}
        >
          <InactiveIcon />
        </div>
      </div>
    </button>
  );
}
```

The non-absolute icon, `InactiveIcon`, defines the layout size. The absolute one, `ActiveIcon`, overlays it without affecting flow.

### Choosing between Motion and CSS

| | Motion (Framer Motion) | CSS transitions (both icons in DOM) |
| --- | --- | --- |
| **Enter animation** | Yes | Yes |
| **Exit animation** | Yes (via `AnimatePresence`) | Yes (cross-fade, icon never unmounts) |
| **Spring physics** | Yes | No, use `cubic-bezier(0.2, 0, 0, 1)` as approximation |
| **When to use** | Project already uses `motion` or `framer-motion` | No motion dependency, or keeping bundle small |

Check the project's `package.json`. Import from `"motion/react"` when `motion` is installed, or `"framer-motion"` when that is. Where both exist, follow the imports the component or its nearest peers already use. Where neither is present, use the CSS cross-fade and never add a dependency just for icon transitions.

### When to animate icons

| Animate | Don't animate |
| --- | --- |
| Icons that appear on hover (action buttons) | Static navigation icons |
| State change icons (play → pause, like → liked) | Decorative icons |
| Icons in contextual toolbars | Icons that are always visible |
| Loading/success state indicators | Icon labels (text next to icon) |

Use exactly these values for contextual icon animations. Do not deviate:
- `scale`: `0.25` → `1` (never use `0.5` or `0.6`)
- `opacity`: `0` → `1`
- `filter`: `"blur(4px)"` → `"blur(0px)"`
- `transition`: `{ type: "spring", duration: 0.3, bounce: 0 }`; **bounce must always be `0`**, never `0.1` or any other value

