<!-- Context: workflows/design-iteration-stage-theme | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Stage 2: Theme Design

**Purpose**: Define colors, typography, spacing, and visual style

## Process

1. Read design plan file from `.tmp/design-plans/{name}.md`
2. Review approved layout from Stage 1
3. Choose design system (neo-brutalism, modern dark, custom)
4. Select color palette (avoid Bootstrap blue unless requested)
5. Choose typography (Google Fonts)
6. Define spacing and shadows
7. Generate theme CSS file
8. **Update plan file** with theme specifications
9. Present theme to user for approval
10. **Update plan file** with user feedback and approval status

## Deliverable

- CSS theme file saved to `design_iterations/theme_N.css`
- Updated plan file with Stage 2 complete

## Theme Selection Criteria

| Style | Use When | Avoid When |
|-------|----------|------------|
| Neo-Brutalism | Creative/artistic projects, retro aesthetic | Enterprise apps, accessibility-critical |
| Modern Dark | SaaS, developer tools, professional dashboards | Playful consumer apps |
| Custom | Specific brand requirements | Time-constrained projects |

## Example Output

```
## Theme Design: Modern Professional

**Style Reference**: Vercel/Linear aesthetic
**Color Palette**: Monochromatic with accent
**Typography**: Inter (UI) + JetBrains Mono (code)
**Spacing**: 4px base unit
**Shadows**: Subtle, soft elevation

**Theme File**: design_iterations/theme_1.css

Key Design Decisions:
- Primary: Neutral gray for professional feel
- Accent: Subtle blue for interactive elements
- Radius: 0.625rem for modern, friendly feel
- Shadows: Soft, minimal elevation
- Fonts: System-like for familiarity
```

## File Naming

`theme_1.css`, `theme_2.css`, etc.

## Best Practices

✅ **Do**:
- Reference design system context files
- Use CSS custom properties
- Save theme to separate file
- Consider accessibility (contrast ratios)
- Avoid Bootstrap blue unless requested

❌ **Don't**:
- Hardcode colors in HTML
- Use generic/overused color schemes
- Skip contrast testing
- Mix color formats (stick to OKLCH)

## Approval Gate

"Does this theme match your vision, or would you like adjustments?"

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Stage 1: Layout](./design-iteration-stage-layout.md)
- [Stage 3: Animation](./design-iteration-stage-animation.md)
- [Design Systems Context](../../ui/web/design-systems.md)
- [UI Styling Standards](../../ui/web/ui-styling-standards.md)
