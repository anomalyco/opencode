# Enter and exit animations

Staged entrances and the exits that follow them. For interactive state feedback see [animations.md](animations.md); for icon swaps see [icon-transitions.md](icon-transitions.md).

## Enter animations: split and stagger

Use this for infrequent staged entrances where sequence communicates hierarchy: the first load of a page hero, a success state, an empty state. Break a large container into semantic chunks and animate each one. Never stagger routine interactions such as row hovers, keystrokes, or repeated tab changes.

### Step by step

1. **Split** into logical groups (title, description, buttons)
2. **Stagger** with ~100ms delay between groups
3. **For titles**, consider splitting into individual words with ~80ms stagger
4. **Combine** `opacity`, `blur` and `translateY` for the enter effect

### Code example

```tsx
// Motion (Framer Motion): staggered enter
function PageHeader() {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.1 } },
      }}
    >
      <motion.h1
        variants={{
          hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
          visible: { opacity: 1, y: 0, filter: "blur(0px)" },
        }}
      >
        Welcome
      </motion.h1>

      <motion.p
        variants={{
          hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
          visible: { opacity: 1, y: 0, filter: "blur(0px)" },
        }}
      >
        A description of the page.
      </motion.p>

      <motion.div
        variants={{
          hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
          visible: { opacity: 1, y: 0, filter: "blur(0px)" },
        }}
      >
        <Button>Get started</Button>
      </motion.div>
    </motion.div>
  );
}
```

### CSS-only stagger

```css
.stagger-item {
  opacity: 0;
  transform: translateY(12px);
  filter: blur(4px);
  animation: fadeInUp 400ms ease-out forwards;
}

.stagger-item:nth-child(1) { animation-delay: 0ms; }
.stagger-item:nth-child(2) { animation-delay: 100ms; }
.stagger-item:nth-child(3) { animation-delay: 200ms; }

@keyframes fadeInUp {
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}
```

## Exit animations

Exits are softer and less attention-grabbing than enters. The user's focus is moving to the next thing, so do not fight for it.

### Subtle exit (recommended)

```tsx
// Small fixed translateY: indicates direction without drama
<motion.div
  exit={{
    opacity: 0,
    y: -12,
    filter: "blur(4px)",
    transition: { duration: 0.15, ease: "easeOut" },
  }}
>
  {content}
</motion.div>
```

### Full exit (when context matters)

```tsx
// Slide fully out: use when spatial context is important
// (e.g., a card returning to a list, a drawer closing)
<motion.div
  exit={{
    opacity: 0,
    x: "-100%",
    transition: { duration: 0.2, ease: "easeOut" },
  }}
>
  {content}
</motion.div>
```

### Good vs. bad

```css
/* Good: subtle exit */
.item-exit {
  opacity: 0;
  transform: translateY(-12px);
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}

/* Bad: dramatic exit that steals focus */
.item-exit {
  opacity: 0;
  transform: translateY(-100%) scale(0.5);
  transition: all 400ms ease-out;
}

/* Sometimes correct: remove immediately when motion adds no context */
.item-exit {
  display: none;
}
```

**Key points:**
- Use a small fixed `translateY`, say `-12px`, rather than the full container height
- Keep some directional movement to indicate where the element went
- Exit duration should be shorter than enter duration (150ms vs 300ms)
- Use a subtle exit when it preserves spatial context. Remove immediately when motion adds no information, the interaction repeats frequently, or reduced motion is requested.

