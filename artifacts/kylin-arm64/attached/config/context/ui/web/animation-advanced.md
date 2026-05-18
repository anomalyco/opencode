<!-- Context: ui/web/animation-advanced | Priority: medium | Version: 1.0 | Updated: 2025-12-09 -->
# Advanced Animation Patterns

Recipes, best practices, micro-interactions, and accessibility considerations.

---

## Page Transitions

### Route Changes

```css
/* Page fade out */
.page-exit {
  animation: fadeOut 200ms ease-in;
}
@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* Page fade in */
.page-enter {
  animation: fadeIn 300ms ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

**Micro-syntax**:
```
pageExit: 200ms ease-in [α1→0]
pageEnter: 300ms ease-out [α0→1]
```

---

## Micro-Interactions

### Hover Effects

```css
/* Link underline slide */
.link {
  position: relative;
}
.link::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 0;
  height: 2px;
  background: currentColor;
  transition: width 250ms ease-out;
}
.link:hover::after {
  width: 100%;
}
```

**Micro-syntax**:
```
linkHover: 250ms ease-out [width0→100%]
```

### Toggle Switches

```css
/* Toggle slide */
.toggle-switch {
  transition: background-color 200ms ease-out;
}
.toggle-switch .thumb {
  transition: transform 200ms ease-out;
}
.toggle-switch.on .thumb {
  transform: translateX(20px);
}
```

**Micro-syntax**:
```
toggle: 200ms ease-out [X0→20, bg→accent]
```

---

## Animation Recipes

### Chat UI Complete Animation System

```
## Core Message Flow
userMsg: 400ms ease-out [Y+20→0, X+10→0, S0.9→1]
aiMsg: 600ms bounce [Y+15→0, S0.95→1] +200ms
typing: 1400ms ∞ [Y±8, α0.4→1] stagger+200ms
status: 300ms ease-out [α0.6→1, S1→1.05→1]

## Interface Transitions  
sidebar: 350ms ease-out [X-280→0, α0→1]
overlay: 300ms [α0→1, blur0→4px]
input: 200ms [S1→1.01, shadow+ring] focus
input: 150ms [S1.01→1, shadow-ring] blur

## Button Interactions
sendBtn: 150ms [S1→0.95→1, R±2°] press
sendBtn: 200ms [S1→1.05, shadow↗] hover
ripple: 400ms [S0→2, α1→0]

## Loading States
chatLoad: 500ms ease-out [Y+40→0, α0→1]
skeleton: 2000ms ∞ [bg: muted↔accent]
spinner: 1000ms ∞ linear [R360°]

## Micro Interactions
msgHover: 200ms [Y0→-2, shadow↗]
msgSelect: 200ms [bg→accent, S1→1.02]
error: 400ms [X±5] shake
success: 600ms bounce [S0→1.2→1, R360°]

## Scroll & Navigation
autoScroll: 400ms smooth
scrollHint: 800ms ∞×3 [Y±5]
```

---

## Best Practices

### Do's ✅

- Keep animations under 400ms for most interactions
- Use `transform` and `opacity` for 60fps performance
- Provide purpose for every animation
- Use ease-out for entrances, ease-in for exits
- Test on low-end devices
- Respect `prefers-reduced-motion`
- Stagger animations for lists (50-100ms delay)
- Use consistent timing across similar interactions

### Don'ts ❌

- Don't animate width/height (use scale instead)
- Don't use animations longer than 800ms
- Don't animate too many elements at once
- Don't use animations without purpose
- Don't ignore accessibility preferences
- Don't use jarring/distracting animations
- Don't animate on every interaction
- Don't use complex easing for simple interactions

---

## Accessibility

### Reduced Motion

```css
/* Respect user preferences */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Focus Indicators

```css
/* Always animate focus states */
:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  transition: outline-offset 150ms ease-out;
}
```

---

## References

- [Web Animation API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API)
- [CSS Easing Functions](https://easings.net/)
- [Animation Performance](https://web.dev/animations-guide/)
- [Reduced Motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

---

## Related Files

- [Animation Basics](./animation-basics.md) - Fundamentals
- [Animation Components](./animation-components.md) - Common UI patterns
- [Loading Animations](./animation-loading.md) - Loading states
