<!-- Context: workflows/design-iteration-stage-animation | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Stage 3: Animation Design

**Purpose**: Define micro-interactions and transitions

## Process

1. Read design plan file from `.tmp/design-plans/{name}.md`
2. Review approved theme from Stage 2
3. Identify key interactions (hover, click, scroll)
4. Define animation timing and easing
5. Plan loading states and transitions
6. Document animations using micro-syntax
7. **Update plan file** with animation specifications
8. Present animation plan to user for approval
9. **Update plan file** with user feedback and approval status

## Deliverable

- Animation specification in micro-syntax format
- Updated plan file with Stage 3 complete

## Example Output

```
## Animation Design: Smooth & Professional

### Button Interactions
hover: 200ms ease-out [Y0→-2, shadow↗]
press: 100ms ease-in [S1→0.95]
ripple: 400ms ease-out [S0→2, α1→0]

### Card Interactions
cardHover: 300ms ease-out [Y0→-4, shadow↗]
cardClick: 200ms ease-out [S1→1.02]

### Page Transitions
pageEnter: 300ms ease-out [α0→1, Y+20→0]
pageExit: 200ms ease-in [α1→0]

### Loading States
spinner: 1000ms ∞ linear [R360°]
skeleton: 2000ms ∞ [bg: muted↔accent]

### Micro-Interactions
inputFocus: 200ms ease-out [S1→1.01, ring]
linkHover: 250ms ease-out [underline 0→100%]

**Philosophy**: Subtle, purposeful animations that enhance UX without distraction
**Performance**: All animations use transform/opacity for 60fps
**Accessibility**: Respects prefers-reduced-motion
```

## Best Practices

✅ **Do**:
- Use micro-syntax for documentation
- Keep animations under 400ms
- Use transform/opacity for performance
- Respect prefers-reduced-motion
- Make animations purposeful

❌ **Don't**:
- Animate width/height (use scale)
- Create distracting animations
- Ignore performance implications
- Skip accessibility considerations

## Approval Gate

"Are these animations appropriate for your design, or should we adjust?"

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Stage 2: Theme](./design-iteration-stage-theme.md)
- [Stage 4: Implementation](./design-iteration-stage-implementation.md)
- [Animation Basics](../../ui/web/animation-basics.md)
