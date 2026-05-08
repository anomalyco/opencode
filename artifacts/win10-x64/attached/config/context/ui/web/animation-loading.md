<!-- Context: ui/web/animation-loading | Priority: medium | Version: 1.0 | Updated: 2025-12-09 -->
# Loading State Animations

Animation patterns for skeleton screens, spinners, progress bars, and status indicators.

---

## Skeleton Screens

```css
/* Skeleton shimmer */
.skeleton {
  animation: shimmer 2000ms infinite;
  background: linear-gradient(
    90deg,
    var(--muted) 0%,
    var(--accent) 50%,
    var(--muted) 100%
  );
  background-size: 200% 100%;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**Micro-syntax**:
```
skeleton: 2000ms ∞ [bg: muted↔accent]
```

---

## Spinners

```css
/* Circular spinner */
.spinner {
  animation: spin 1000ms linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Pulsing dots */
.loading-dots span {
  animation: dotPulse 1500ms infinite;
}
.loading-dots span:nth-child(2) { animation-delay: 200ms; }
.loading-dots span:nth-child(3) { animation-delay: 400ms; }
@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; scale: 0.8; }
  40% { opacity: 1; scale: 1; }
}
```

**Micro-syntax**:
```
spinner: 1000ms ∞ linear [R360°]
dotPulse: 1500ms ∞ [α0.3→1→0.3, S0.8→1→0.8] stagger+200ms
```

---

## Progress Bars

```css
/* Indeterminate progress */
.progress-bar {
  animation: progress 2000ms ease-in-out infinite;
}
@keyframes progress {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(0); }
  100% { transform: translateX(100%); }
}
```

**Micro-syntax**:
```
progress: 2000ms ∞ ease-in-out [X-100%→0→100%]
```

---

## Status Indicators

```css
/* Online status pulse */
.status-online {
  animation: pulse 2000ms infinite;
}
@keyframes pulse {
  0%, 100% {
    opacity: 1;
    scale: 1;
  }
  50% {
    opacity: 0.6;
    scale: 1.05;
  }
}
```

**Micro-syntax**:
```
status: 2000ms ∞ [α1→0.6→1, S1→1.05→1]
```

---

## Related Files

- [Animation Basics](./animation-basics.md) - Fundamentals
- [Form Animations](./animation-forms.md) - Form patterns
- [Advanced Animations](./animation-advanced.md) - Recipes & best practices
