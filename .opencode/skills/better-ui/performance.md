# Performance

Transition specificity and GPU compositing hints.

## Transition only what changes

Never use `transition: all` or Tailwind's `transition-all`. Always name the exact properties that change. Tailwind's bare `transition` maps to a curated list of colors, opacity, shadow and transforms rather than `all`, and naming what changes is still better.

### Why

- `transition: all` forces the browser to watch every property for changes
- Causes unexpected transitions on properties you didn't intend to animate (colors, padding, shadows)
- Prevents browser optimizations

### CSS example

```css
/* Good: only transition what changes */
.button {
  transition-property: scale, background-color;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}

/* Bad: transition everything */
.button {
  transition: all 150ms ease-out;
}
```

### Tailwind

```tsx
// Good: explicit properties
<button className="transition-[scale,background-color] duration-150 ease-out">

// Bad: transition all
<button className="transition-all duration-150 ease-out">
```

### Tailwind `transition-transform` note

`transition-transform` in Tailwind maps to `transition-property: transform, translate, scale, rotate`, covering every transform-related property rather than only `transform`. Use it when animating transforms alone. For several non-transform properties, use the bracket syntax `transition-[scale,opacity,filter]`.

## Use `will-change` sparingly

`will-change` hints the browser to pre-promote an element to its own GPU compositing layer. Without it the browser promotes only when the animation starts, and that one-time promotion can cause a micro-stutter on the first frame.

It helps most for `scale`, `rotation` and movement through `transform`. For other properties it does little, because the browser cannot composite them on the GPU anyway.

### Rules

```css
/* Good: specific property that benefits from GPU compositing */
.animated-card {
  will-change: transform;
}

/* Good: multiple compositor-friendly properties */
.animated-card {
  will-change: transform, opacity;
}

/* Bad: never use will-change: all */
.animated-card {
  will-change: all;
}

/* Bad: properties that can't be GPU-composited anyway */
.animated-card {
  will-change: background-color, padding;
}
```

### Useful properties

| Property | GPU-compositable | Worth using `will-change` |
| --- | --- | --- |
| `transform` | Yes | Yes |
| `opacity` | Yes | Yes |
| `filter` (blur, brightness) | Yes | Yes |
| `clip-path` | Newer Chromium only | Rarely; not reliable cross-browser |
| `top`, `left`, `width`, `height` | No | No |
| `background`, `border`, `color` | No | No |

### When to skip

Modern browsers optimize well on their own. Add `will-change` only when you see first-frame stutter, which Safari benefits from most. Never add it preemptively to every animated element, since each extra compositing layer costs memory.
