<!-- Context: ui/web/animation-forms | Priority: medium | Version: 1.0 | Updated: 2025-12-09 -->
# Form Animation Patterns

Animation patterns for form inputs, validation states, and scroll animations.

---

## Focus States

```css
/* Input focus - ring and scale */
.input {
  transition: all 200ms ease-out;
}
.input:focus {
  transform: scale(1.01);
  box-shadow: 0 0 0 3px var(--ring);
}

/* Input blur - return to normal */
.input:not(:focus) {
  transition: all 150ms ease-in;
}
```

**Micro-syntax**:
```
inputFocus: 200ms ease-out [S1→1.01, shadow+ring]
inputBlur: 150ms ease-in [S1.01→1, shadow-ring]
```

---

## Validation States

```css
/* Error shake */
.input-error {
  animation: shake 400ms ease-in-out;
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

/* Success checkmark */
.input-success::after {
  animation: checkmark 600ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
@keyframes checkmark {
  from {
    transform: scale(0) rotate(0deg);
    opacity: 0;
  }
  to {
    transform: scale(1.2) rotate(360deg);
    opacity: 1;
  }
}
```

**Micro-syntax**:
```
error: 400ms ease-in-out [X±5] shake
success: 600ms bounce [S0→1.2, R0→360°, α0→1]
```

---

## Scroll Animations

### Scroll-Triggered Fade In

```css
.fade-in-on-scroll {
  opacity: 0;
  transform: translateY(40px);
  transition: opacity 500ms ease-out, transform 500ms ease-out;
}
.fade-in-on-scroll.visible {
  opacity: 1;
  transform: translateY(0);
}
```

**Micro-syntax**:
```
scrollFadeIn: 500ms ease-out [Y+40→0, α0→1]
```

### Auto-Scroll

```css
html {
  scroll-behavior: smooth;
}

.scroll-hint {
  animation: scrollHint 800ms infinite;
  animation-iteration-count: 3;
}
@keyframes scrollHint {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(5px); }
}
```

**Micro-syntax**:
```
autoScroll: 400ms smooth
scrollHint: 800ms ∞×3 [Y±5]
```

---

## Related Files

- [Animation Basics](./animation-basics.md) - Fundamentals
- [Animation Components](./animation-components.md) - Common UI patterns
- [Loading Animations](./animation-loading.md) - Loading states
