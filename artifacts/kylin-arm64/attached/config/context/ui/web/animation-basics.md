<!-- Context: ui/web/animation-basics | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Animation Basics

## Overview

Standards and patterns for UI animations, micro-interactions, and transitions. Animations should feel natural, purposeful, and enhance user experience without causing distraction.

## Quick Reference

**Timing**: 150-400ms for most interactions
**Easing**: ease-out for entrances, ease-in for exits
**Purpose**: Every animation should have a clear purpose
**Performance**: Use transform and opacity for 60fps

---

## Animation Micro-Syntax

### Notation Guide

**Format**: `element: duration easing [properties] modifiers`

**Symbols**:
- `→` = transition from → to
- `±` = oscillate/shake
- `↗` = increase
- `↘` = decrease
- `∞` = infinite loop
- `×N` = repeat N times
- `+Nms` = delay N milliseconds

**Properties**:
- `Y` = translateY
- `X` = translateX
- `S` = scale
- `R` = rotate
- `α` = opacity
- `bg` = background

**Example**: `button: 200ms ease-out [S1→1.05, α0.8→1]`
- Button scales from 1 to 1.05 and fades from 0.8 to 1 over 200ms with ease-out

---

## Core Animation Principles

### Timing Standards

```
Ultra-fast:  100-150ms  (micro-feedback, hover states)
Fast:        150-250ms  (button clicks, toggles)
Standard:    250-350ms  (modals, dropdowns, navigation)
Moderate:    350-500ms  (page transitions, complex animations)
Slow:        500-800ms  (dramatic reveals, storytelling)
```

### Easing Functions

```css
/* Entrances - start slow, end fast */
ease-out: cubic-bezier(0, 0, 0.2, 1);

/* Exits - start fast, end slow */
ease-in: cubic-bezier(0.4, 0, 1, 1);

/* Both - smooth throughout */
ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

/* Bounce - playful, attention-grabbing */
bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);

/* Elastic - spring-like */
elastic: cubic-bezier(0.68, -0.6, 0.32, 1.6);
```

### Performance Guidelines

**60fps Animations** (GPU-accelerated):
- ✅ `transform` (translate, scale, rotate)
- ✅ `opacity`
- ✅ `filter` (with caution)

**Avoid** (causes reflow/repaint):
- ❌ `width`, `height`
- ❌ `top`, `left`, `right`, `bottom`
- ❌ `margin`, `padding`

---

## Related Files

- [Animation Components](./animation-components.md) - Common UI patterns
- [Loading Animations](./animation-loading.md) - Loading states
- [Advanced Animations](./animation-advanced.md) - Recipes & best practices
