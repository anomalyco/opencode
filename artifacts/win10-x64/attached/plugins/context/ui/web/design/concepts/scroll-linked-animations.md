<!-- Context: ui/scroll-linked-animations | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Concept: Scroll-Linked Animations

**Purpose**: Sync image sequences to scroll position for cinematic product reveals

**Last Updated**: 2026-01-07

---

## Core Idea

Map scroll position to video frames. As user scrolls, play through image sequence like a scrubbing timeline. Creates illusion of 3D animation controlled by scroll.

**Formula**: `scrollProgress (0→1) → frameIndex (0→N) → canvas.drawImage()`

---

## Essential Parts

1. **Image sequence** - 60-150 WebP frames from video/3D render
2. **Sticky canvas** - Fixed HTML5 canvas, always visible while scrolling
3. **Scroll tracker** - Framer Motion `useScroll` hook
4. **Preloader** - Load all frames upfront (prevents flicker)
5. **Background match** - Page BG = image BG (hides edges)

---

## Minimal Example

```tsx
const { scrollYProgress } = useScroll({ target: containerRef })
const frameIndex = useTransform(scrollYProgress, [0, 1], [0, 119])

useEffect(() => {
  ctx.drawImage(images[Math.round(frameIndex)], 0, 0)
}, [frameIndex])
```

**Why canvas?** 10x faster than swapping `<img src>`. DOM updates are slow.

---

## Related

- examples/scrollytelling-headphone.md - Full code
- guides/building-scrollytelling-pages.md - Implementation
- lookup/scroll-animation-prompts.md - Generate sequences

---

## Reference

[Apple AirPods Pro](https://www.apple.com/airpods-pro/) - Production example
