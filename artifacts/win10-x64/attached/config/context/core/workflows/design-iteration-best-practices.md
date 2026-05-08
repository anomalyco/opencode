<!-- Context: workflows/design-iteration-best-practices | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Design Iteration Best Practices

## Iteration Process

### When to Create Iterations

**Create new iteration** (`{name}_1_1.html`) when:
- User requests changes to existing design
- Refining based on feedback
- A/B testing variations
- Progressive enhancement

**Create new design** (`{name}_2.html`) when:
- Complete redesign requested
- Different approach/style
- Alternative layout structure

### Iteration Workflow

```
User: "Can you make the buttons larger and change the color?"

1. Read current file: dashboard_1.html
2. Make requested changes
3. Save as: dashboard_1_1.html
4. Present changes to user

User: "Perfect! Now can we add a sidebar?"

1. Read current file: dashboard_1_1.html
2. Add sidebar component
3. Save as: dashboard_1_2.html
4. Present changes to user
```

---

## File Management

### Folder Structure

```
design_iterations/
├── theme_1.css
├── theme_2.css
├── landing_1.html
├── landing_1_1.html
├── landing_1_2.html
├── dashboard_1.html
├── dashboard_1_1.html
└── README.md (optional: design notes)
```

### Version Control

**Track iterations**:
- Initial: `design_1.html`
- Iteration 1: `design_1_1.html`
- Iteration 2: `design_1_2.html`
- Iteration 3: `design_1_3.html`

**New major version**:
- Complete redesign: `design_2.html`
- Then iterate: `design_2_1.html`, `design_2_2.html`

---

## Communication Patterns

### Stage Transitions

**After Layout**:
```
"Here's the proposed layout structure. The design uses a [description].
Would you like to proceed with this layout, or should we make adjustments?"
```

**After Theme**:
```
"I've created a [style] theme with [key features]. The theme file is saved as theme_N.css.
Does this match your vision, or would you like to adjust colors/typography?"
```

**After Animation**:
```
"Here's the animation plan using [timing/style]. All animations are optimized for performance.
Are these animations appropriate, or should we adjust the timing/effects?"
```

**After Implementation**:
```
"I've created the complete design as {filename}.html. The design includes [key features].
Please review and let me know if you'd like any changes or iterations."
```

### Iteration Requests

**User requests change**:
```
"I'll update the design with [changes] and save it as {filename}_N.html.
This preserves the previous version for reference."
```

---

## Quality Checklist

Before presenting each stage:

**Layout Stage**:
- [ ] ASCII wireframe is clear and detailed
- [ ] Components are well-organized
- [ ] Responsive behavior is planned
- [ ] User approval requested

**Theme Stage**:
- [ ] Theme file created and saved
- [ ] Colors use OKLCH format
- [ ] Fonts loaded from Google Fonts
- [ ] Contrast ratios meet WCAG AA
- [ ] User approval requested

**Animation Stage**:
- [ ] Animations documented in micro-syntax
- [ ] Timing is appropriate (< 400ms)
- [ ] Performance optimized (transform/opacity)
- [ ] Accessibility considered
- [ ] User approval requested

**Implementation Stage**:
- [ ] Single HTML file created
- [ ] Theme CSS referenced
- [ ] Tailwind loaded via script tag
- [ ] Icons initialized
- [ ] Responsive design tested
- [ ] Accessibility attributes added
- [ ] Images use valid placeholder URLs
- [ ] Semantic HTML used
- [ ] User review requested

---

## Troubleshooting

### Common Issues

**Issue**: User wants to skip stages
**Solution**: Explain benefits of structured approach, but accommodate if insisted

**Issue**: Theme doesn't match user vision
**Solution**: Iterate on theme file, create theme_2.css with adjustments

**Issue**: Animations feel too slow/fast
**Solution**: Adjust timing in micro-syntax, regenerate with new values

**Issue**: Design doesn't work on mobile
**Solution**: Review responsive breakpoints, add mobile-specific styles

**Issue**: Colors have poor contrast
**Solution**: Use WCAG contrast checker, adjust OKLCH lightness values

---

## References

- [Design Systems Context](../../ui/web/design-systems.md)
- [UI Styling Standards](../../ui/web/ui-styling-standards.md)
- [Animation Basics](../../ui/web/animation-basics.md)
- [ASCII Art Generator](https://www.asciiart.eu/)
- [WCAG Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Stage 4: Implementation](./design-iteration-stage-implementation.md)
- [Plan Iterations](./design-iteration-plan-iterations.md)
