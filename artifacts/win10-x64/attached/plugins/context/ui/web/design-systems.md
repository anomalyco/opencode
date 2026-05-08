<!-- Context: development/design-systems | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Design Systems

## Overview

This context file provides reusable design system patterns, theme templates, and color systems for frontend design work. Use these as starting points for creating cohesive, professional UI designs.

## Quick Reference

**Color Format**: OKLCH (perceptually uniform color space)
**Theme Variables**: CSS custom properties (--variable-name)
**Font Sources**: Google Fonts
**Responsive**: All designs must be mobile-first responsive

---

## Theme Patterns

### Neo-Brutalism Style

**Characteristics**: 90s web design aesthetic, bold borders, flat shadows, high contrast

**Use Cases**: 
- Retro/vintage applications
- Bold, statement-making interfaces
- Art/creative portfolios
- Playful consumer apps

**Theme Template**:

```css
:root {
  /* Colors - High contrast, bold */
  --background: oklch(1.0000 0 0);
  --foreground: oklch(0 0 0);
  --card: oklch(1.0000 0 0);
  --card-foreground: oklch(0 0 0);
  --popover: oklch(1.0000 0 0);
  --popover-foreground: oklch(0 0 0);
  --primary: oklch(0.6489 0.2370 26.9728);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.9680 0.2110 109.7692);
  --secondary-foreground: oklch(0 0 0);
  --muted: oklch(0.9551 0 0);
  --muted-foreground: oklch(0.3211 0 0);
  --accent: oklch(0.5635 0.2408 260.8178);
  --accent-foreground: oklch(1.0000 0 0);
  --destructive: oklch(0 0 0);
  --destructive-foreground: oklch(1.0000 0 0);
  --border: oklch(0 0 0);
  --input: oklch(0 0 0);
  --ring: oklch(0.6489 0.2370 26.9728);
  
  /* Chart colors */
  --chart-1: oklch(0.6489 0.2370 26.9728);
  --chart-2: oklch(0.9680 0.2110 109.7692);
  --chart-3: oklch(0.5635 0.2408 260.8178);
  --chart-4: oklch(0.7323 0.2492 142.4953);
  --chart-5: oklch(0.5931 0.2726 328.3634);
  
  /* Sidebar */
  --sidebar: oklch(0.9551 0 0);
  --sidebar-foreground: oklch(0 0 0);
  --sidebar-primary: oklch(0.6489 0.2370 26.9728);
  --sidebar-primary-foreground: oklch(1.0000 0 0);
  --sidebar-accent: oklch(0.5635 0.2408 260.8178);
  --sidebar-accent-foreground: oklch(1.0000 0 0);
  --sidebar-border: oklch(0 0 0);
  --sidebar-ring: oklch(0.6489 0.2370 26.9728);
  
  /* Typography */
  --font-sans: DM Sans, sans-serif;
  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  --font-mono: Space Mono, monospace;
  
  /* Border radius - Sharp corners */
  --radius: 0px;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  
  /* Shadows - Bold, offset shadows */
  --shadow-2xs: 4px 4px 0px 0px hsl(0 0% 0% / 0.50);
  --shadow-xs: 4px 4px 0px 0px hsl(0 0% 0% / 0.50);
  --shadow-sm: 4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 1px 2px -1px hsl(0 0% 0% / 1.00);
  --shadow: 4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 1px 2px -1px hsl(0 0% 0% / 1.00);
  --shadow-md: 4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 2px 4px -1px hsl(0 0% 0% / 1.00);
  --shadow-lg: 4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 4px 6px -1px hsl(0 0% 0% / 1.00);
  --shadow-xl: 4px 4px 0px 0px hsl(0 0% 0% / 1.00), 4px 8px 10px -1px hsl(0 0% 0% / 1.00);
  --shadow-2xl: 4px 4px 0px 0px hsl(0 0% 0% / 2.50);
  
  /* Spacing */
  --tracking-normal: 0em;
  --spacing: 0.25rem;
}
```

---

### Modern Dark Mode Style

**Characteristics**: Clean, minimal, professional (Vercel/Linear aesthetic)

**Use Cases**:
- SaaS applications
- Developer tools
- Professional dashboards
- Enterprise applications
- Modern web apps

**Theme Template**:

```css
:root {
  /* Colors - Subtle, professional */
  --background: oklch(1 0 0);
  --foreground: oklch(0.1450 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.1450 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.1450 0 0);
  --primary: oklch(0.2050 0 0);
  --primary-foreground: oklch(0.9850 0 0);
  --secondary: oklch(0.9700 0 0);
  --secondary-foreground: oklch(0.2050 0 0);
  --muted: oklch(0.9700 0 0);
  --muted-foreground: oklch(0.5560 0 0);
  --accent: oklch(0.9700 0 0);
  --accent-foreground: oklch(0.2050 0 0);
  --destructive: oklch(0.5770 0.2450 27.3250);
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.9220 0 0);
  --input: oklch(0.9220 0 0);
  --ring: oklch(0.7080 0 0);
  
  /* Chart colors - Monochromatic blues */
  --chart-1: oklch(0.8100 0.1000 252);
  --chart-2: oklch(0.6200 0.1900 260);
  --chart-3: oklch(0.5500 0.2200 263);
  --chart-4: oklch(0.4900 0.2200 264);
  --chart-5: oklch(0.4200 0.1800 266);
  
  /* Sidebar */
  --sidebar: oklch(0.9850 0 0);
  --sidebar-foreground: oklch(0.1450 0 0);
  --sidebar-primary: oklch(0.2050 0 0);
  --sidebar-primary-foreground: oklch(0.9850 0 0);
  --sidebar-accent: oklch(0.9700 0 0);
  --sidebar-accent-foreground: oklch(0.2050 0 0);
  --sidebar-border: oklch(0.9220 0 0);
  --sidebar-ring: oklch(0.7080 0 0);
  
  /* Typography - System fonts */
  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  
  /* Border radius - Rounded */
  --radius: 0.625rem;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  
  /* Shadows - Subtle, soft */
  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);
  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);
  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);
  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);
  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);
  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);
  
  /* Spacing */
  --tracking-normal: 0em;
  --spacing: 0.25rem;
}
```

---

## Typography System

### Recommended Font Families

**Monospace Fonts** (Code, technical interfaces):
- JetBrains Mono
- Fira Code
- Source Code Pro
- IBM Plex Mono
- Roboto Mono
- Space Mono
- Geist Mono

**Sans-Serif Fonts** (UI, body text):
- Inter
- Roboto
- Open Sans
- Poppins
- Montserrat
- Outfit
- Plus Jakarta Sans
- DM Sans
- Geist
- Space Grotesk

**Display/Decorative Fonts**:
- Oxanium
- Architects Daughter

**Serif Fonts** (Editorial, formal):
- Merriweather
- Playfair Display
- Lora
- Source Serif Pro
- Libre Baskerville

### Font Loading

Always use Google Fonts for consistency and reliability:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

---

## Color System Guidelines

### OKLCH Color Space

Use OKLCH for perceptually uniform colors:
- **L** (Lightness): 0-1 (0 = black, 1 = white)
- **C** (Chroma): 0-0.4 (saturation)
- **H** (Hue): 0-360 (color angle)

**Format**: `oklch(L C H)`

**Example**: `oklch(0.6489 0.2370 26.9728)` = vibrant orange

### Color Palette Rules

1. **Avoid Bootstrap Blue**: Unless explicitly requested, avoid generic blue (#007bff)
2. **Semantic Colors**: Use meaningful color names (--primary, --destructive, --success)
3. **Contrast**: Ensure WCAG AA compliance (4.5:1 for text)
4. **Consistency**: Use theme variables, not hardcoded colors

### Background/Foreground Pairing

**Rule**: Background should contrast with content

- Light component → Dark background
- Dark component → Light background
- Ensures visibility and visual hierarchy

---

## Shadow System

### Shadow Scales

Shadows create depth and hierarchy:

- `--shadow-2xs`: Minimal elevation (1-2px)
- `--shadow-xs`: Subtle lift (2-3px)
- `--shadow-sm`: Small cards (3-4px)
- `--shadow`: Default elevation (4-6px)
- `--shadow-md`: Medium cards (6-8px)
- `--shadow-lg`: Modals, dropdowns (8-12px)
- `--shadow-xl`: Floating panels (12-16px)
- `--shadow-2xl`: Maximum elevation (16-24px)

### Shadow Styles

**Soft Shadows** (Modern):
```css
box-shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10);
```

**Hard Shadows** (Neo-brutalism):
```css
box-shadow: 4px 4px 0px 0px hsl(0 0% 0% / 1.00);
```

---

## Spacing System

### Base Unit

Use `--spacing: 0.25rem` (4px) as base unit

### Scale

- 1x = 0.25rem (4px)
- 2x = 0.5rem (8px)
- 3x = 0.75rem (12px)
- 4x = 1rem (16px)
- 6x = 1.5rem (24px)
- 8x = 2rem (32px)
- 12x = 3rem (48px)
- 16x = 4rem (64px)

---

## Border Radius System

### Radius Scales

```css
--radius-sm: calc(var(--radius) - 4px);
--radius-md: calc(var(--radius) - 2px);
--radius-lg: var(--radius);
--radius-xl: calc(var(--radius) + 4px);
```

### Common Values

- **Sharp** (Neo-brutalism): `--radius: 0px`
- **Subtle** (Modern): `--radius: 0.375rem` (6px)
- **Rounded** (Friendly): `--radius: 0.625rem` (10px)
- **Pill** (Buttons): `--radius: 9999px`

---

## Usage Guidelines

### When to Use Each Theme

**Neo-Brutalism**:
- ✅ Creative/artistic projects
- ✅ Retro/vintage aesthetics
- ✅ Bold, statement-making designs
- ❌ Enterprise/corporate applications
- ❌ Accessibility-critical interfaces

**Modern Dark Mode**:
- ✅ SaaS applications
- ✅ Developer tools
- ✅ Professional dashboards
- ✅ Enterprise applications
- ✅ Accessibility-critical interfaces

### Customization

1. Start with a base theme template
2. Adjust primary/accent colors for brand
3. Modify radius for desired feel
4. Adjust shadows for depth preference
5. Test contrast ratios for accessibility

---

## Best Practices

✅ **Use CSS custom properties** for all theme values
✅ **Test in light and dark modes** if applicable
✅ **Validate color contrast** (WCAG AA minimum)
✅ **Use semantic color names** (--primary, not --blue)
✅ **Load fonts from Google Fonts** for reliability
✅ **Apply consistent spacing** using the spacing scale
✅ **Test responsive behavior** at all breakpoints

❌ **Don't hardcode colors** in components
❌ **Don't use generic blue** (#007bff) without reason
❌ **Don't mix color formats** (stick to OKLCH)
❌ **Don't skip contrast testing**
❌ **Don't use too many font families** (2-3 max)

---

## References

- [OKLCH Color Picker](https://oklch.com/)
- [Google Fonts](https://fonts.google.com/)
- [WCAG Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Tailwind CSS Colors](https://tailwindcss.com/docs/customizing-colors)
