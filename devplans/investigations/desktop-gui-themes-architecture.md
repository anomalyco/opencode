# Desktop GUI Theme Architecture Investigation

## Executive Summary

The OpenCode desktop GUI uses a **completely separate theme system** from the CLI/TUI. The GUI theme system is built around **OKLCH color space**, **CSS Custom Properties (CSS Variables)**, and a **seed-based color scale generation** approach. This is fundamentally different from the TUI/CLI theme system which uses direct RGBA/Hex colors with color reference definitions.

---

## System Comparison

| Aspect | Desktop GUI | CLI/TUI |
|--------|-------------|---------|
| **Color Space** | OKLCH (perceptually uniform) | RGBA/Hex direct values |
| **Output Format** | CSS Custom Properties | Direct color application |
| **Token Count** | ~150 tokens | ~40 properties |
| **Dark/Light Mode** | Per-theme objects | Per-color objects |
| **Color References** | None (flat structure) | Yes (defs + references) |
| **Scale Generation** | Automatic from seeds | Manual color definitions |
| **Schema** | `https://opencode.ai/desktop-theme.json` | `https://opencode.ai/theme.json` |

---

## Desktop GUI Theme Architecture

### Core Files

| File | Purpose |
|------|---------|
| [`packages/ui/src/theme/types.ts`](packages/ui/src/theme/types.ts:1) | Type definitions for themes, seed colors, variants |
| [`packages/ui/src/theme/color.ts`](packages/ui/src/theme/color.ts:1) | OKLCH color conversion and scale generation |
| [`packages/ui/src/theme/resolve.ts`](packages/ui/src/theme/resolve.ts:1) | Theme resolution and token generation |
| [`packages/ui/src/theme/context.tsx`](packages/ui/src/theme/context.tsx:1) | React/Solid context for theme management |
| [`packages/ui/src/theme/loader.ts`](packages/ui/src/theme/loader.ts:1) | Theme loading and CSS injection |
| [`packages/ui/src/theme/themes/*.json`](packages/ui/src/theme/themes/) | Individual theme definition files |
| [`packages/ui/src/theme/default-themes.ts`](packages/ui/src/theme/default-themes.ts:1) | Theme exports and registration |

### Theme Schema

```typescript
// From packages/ui/src/theme/types.ts:26-32
interface DesktopTheme {
  $schema?: string
  name: string           // Display name (e.g., "Dracula")
  id: string             // Theme ID (e.g., "dracula")
  light: ThemeVariant    // Light mode configuration
  dark: ThemeVariant     // Dark mode configuration
}
```

### Theme Variant Structure

```typescript
// From packages/ui/src/theme/types.ts:21-24
interface ThemeVariant {
  seeds: ThemeSeedColors           // Base colors for scale generation
  overrides?: Record<string, string> // Token overrides (optional)
}
```

### Seed Colors

```typescript
// From packages/ui/src/theme/types.ts:9-18
interface ThemeSeedColors {
  neutral: HexColor       // Background/text neutrals
  primary: HexColor       // Primary brand color
  success: HexColor       // Success/positive actions
  warning: HexColor       // Warnings/caution
  error: HexColor         // Errors/negative actions
  info: HexColor          // Informational
  interactive: HexColor   // Interactive elements
  diffAdd: HexColor       // Diff added lines
  diffDelete: HexColor    // Diff deleted lines
}
```

---

## Color System: OKLCH

### Why OKLCH?

OKLCH (Lightness-Chroma-Hue with OK = "optimal colorspace") provides:
- **Perceptual uniformity**: Colors that look equally spaced to humans
- **Gamut support**: Can represent more vibrant colors than sRGB
- **Modern CSS support**: Native `oklch()` function in modern browsers

### Color Conversion Pipeline

```typescript
// From packages/ui/src/theme/color.ts:89-97
export function hexToOklch(hex: HexColor): OklchColor {
  const { r, g, b } = hexToRgb(hex)
  return rgbToOklch(r, g, b)
}

export function oklchToHex(oklch: OklchColor): HexColor {
  const { r, g, b } = oklchToRgb(oklch)
  return rgbToHex(r, g, b)
}
```

### Scale Generation

Themes use **seed colors** to generate **complete color scales** (12 steps each):

```typescript
// From packages/ui/src/theme/color.ts:99-122
export function generateScale(seed: HexColor, isDark: boolean): HexColor[] {
  const base = hexToOklch(seed)
  const scale: HexColor[] = []

  const lightSteps = isDark
    ? [0.15, 0.18, 0.22, 0.26, 0.32, 0.38, 0.46, 0.56, base.l, base.l - 0.05, 0.75, 0.93]
    : [0.99, 0.97, 0.94, 0.9, 0.85, 0.79, 0.72, 0.64, base.l, base.l + 0.05, 0.45, 0.25]

  const chromaMultipliers = isDark
    ? [0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1, 1, 0.9, 0.6]
    : [0.1, 0.15, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1, 1, 0.95, 0.85]

  for (let i = 0; i < 12; i++) {
    scale.push(
      oklchToHex({
        l: lightSteps[i],
        c: base.c * chromaMultipliers[i],
        h: base.h,
      }),
    )
  }

  return scale
}
```

This generates 12-step scales for: neutral, primary, success, warning, error, info, interactive, diffAdd, diffDelete

---

## Theme Resolution & Token Generation

### Resolution Process

```typescript
// From packages/ui/src/theme/resolve.ts:4-296
export function resolveThemeVariant(variant: ThemeVariant, isDark: boolean): ResolvedTheme {
  const { seeds, overrides = {} } = variant

  // Generate all scales from seeds
  const neutral = generateNeutralScale(seeds.neutral, isDark)
  const primary = generateScale(seeds.primary, isDark)
  const success = generateScale(seeds.success, isDark)
  const warning = generateScale(seeds.warning, isDark)
  const error = generateScale(seeds.error, isDark)
  const info = generateScale(seeds.info, isDark)
  const interactive = generateScale(seeds.interactive, isDark)
  const diffAdd = generateScale(seeds.diffAdd, isDark)
  const diffDelete = generateScale(seeds.diffDelete, isDark)

  // Generate ~150 tokens from scales
  const tokens: ResolvedTheme = {}
  
  // Background tokens
  tokens["background-base"] = neutral[0]
  tokens["background-weak"] = neutral[2]
  tokens["background-strong"] = neutral[0]
  tokens["background-stronger"] = isDark ? neutral[1] : "#fcfcfc"
  
  // Surface tokens (with alpha)
  tokens["surface-base"] = neutralAlpha[1]
  tokens["surface-weak"] = neutralAlpha[2]
  tokens["surface-strong"] = isDark ? neutralAlpha[6] : "#ffffff"
  
  // Text tokens
  tokens["text-base"] = neutral[10]
  tokens["text-weak"] = neutral[8]
  tokens["text-strong"] = neutral[11]
  
  // Syntax tokens (with var() references)
  tokens["syntax-comment"] = "var(--text-weak)"
  tokens["syntax-string"] = isDark ? "#00ceb9" : "#006656"
  
  // Markdown tokens
  tokens["markdown-heading"] = isDark ? "#9d7cd8" : "#d68c27"
  tokens["markdown-text"] = isDark ? "#eeeeee" : "#1a1a1a"
  
  // ... 100+ more tokens

  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    tokens[key] = value
  }

  return tokens
}
```

### Token Categories

| Category | Example Tokens |
|----------|----------------|
| **Background** | background-base, background-weak, background-strong |
| **Surface** | surface-base, surface-weak, surface-strong, surface-float |
| **Text** | text-base, text-weak, text-strong, text-interactive |
| **Border** | border-base, border-weak, border-strong, border-active |
| **Icon** | icon-base, icon-hover, icon-active, icon-disabled |
| **Input** | input-base, input-hover, input-active, input-focus |
| **Syntax** | syntax-comment, syntax-string, syntax-keyword, syntax-function |
| **Markdown** | markdown-heading, markdown-text, markdown-link, markdown-code |
| **Diff** | surface-diff-add-base, surface-diff-delete-base, text-diff-add |
| **Avatar** | avatar-background-*, avatar-text-* |

---

## CSS Generation & Application

### CSS Output Format

```typescript
// From packages/ui/src/theme/resolve.ts:321-324
export function themeToCss(tokens: ResolvedTheme): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${key}: ${value};`)
    .join("\n  ")
}
```

### Full CSS Structure

```css
:root {
  color-scheme: light;
  --text-mix-blend-mode: multiply;
  --background-base: #f8f8f2;
  --background-weak: #f1f2ed;
  --text-base: #1f1f2f;
  --text-weak: #52526b;
  --syntax-comment: var(--text-weak);
  --syntax-string: #2fbf71;
  /* ... ~150 tokens ... */
}

@media (prefers-color-scheme: dark) {
  color-scheme: dark;
  --text-mix-blend-mode: plus-lighter;
  --background-base: #14151f;
  --background-weak: #181926;
  --text-base: #f8f8f2;
  --text-weak: #b6b9e4;
  --syntax-comment: var(--text-weak);
  --syntax-string: #50fa7b;
  /* ... ~150 tokens ... */
}
```

### Theme Application

```typescript
// From packages/ui/src/theme/context.tsx:32-54
function applyThemeCss(theme: DesktopTheme, themeId: string, mode: "light" | "dark") {
  const isDark = mode === "dark"
  const variant = isDark ? theme.dark : theme.light
  const tokens = resolveThemeVariant(variant, isDark)
  const css = themeToCss(tokens)

  const fullCss = `:root {
    color-scheme: ${mode};
    --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
    ${css}
  }`

  ensureThemeStyleElement().textContent = fullCss
  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
}
```

---

## Example Theme: Dracula (GUI)

```json
// From packages/ui/src/theme/themes/dracula.json
{
  "$schema": "https://opencode.ai/desktop-theme.json",
  "name": "Dracula",
  "id": "dracula",
  "light": {
    "seeds": {
      "neutral": "#f8f8f2",
      "primary": "#7c6bf5",
      "success": "#2fbf71",
      "warning": "#f7a14d",
      "error": "#d9536f",
      "info": "#1d7fc5",
      "interactive": "#7c6bf5",
      "diffAdd": "#9fe3b3",
      "diffDelete": "#f8a1b8"
    },
    "overrides": {
      "background-base": "#f8f8f2",
      "text-base": "#1f1f2f",
      "syntax-string": "#2fbf71",
      "markdown-heading": "#7c6bf5"
    }
  },
  "dark": {
    "seeds": {
      "neutral": "#1d1e28",
      "primary": "#bd93f9",
      "success": "#50fa7b",
      "warning": "#ffb86c",
      "error": "#ff5555",
      "info": "#8be9fd",
      "interactive": "#bd93f9",
      "diffAdd": "#2fb27d",
      "diffDelete": "#ff6b81"
    },
    "overrides": {
      "background-base": "#14151f",
      "text-base": "#f8f8f2",
      "syntax-string": "#50fa7b",
      "markdown-heading": "#bd93f9"
    }
  }
}
```

---

## Comparison: TUI/CLI Theme Structure

For contrast, here's the TUI/CLI Dracula theme:

```json
// From packages/opencode/src/cli/cmd/tui/context/theme/dracula.json
{
  "$schema": "https://opencode.ai/theme.json",
  "defs": {
    "background": "#282a36",
    "currentLine": "#44475a",
    "selection": "#44475a",
    "foreground": "#f8f8f2",
    "comment": "#6272a4",
    "cyan": "#8be9fd",
    "green": "#50fa7b",
    "orange": "#ffb86c",
    "pink": "#ff79c6",
    "purple": "#bd93f9",
    "red": "#ff5555",
    "yellow": "#f1fa8c"
  },
  "theme": {
    "primary": { "dark": "purple", "light": "purple" },
    "text": { "dark": "foreground", "light": "#282a36" },
    "background": { "dark": "#282a36", "light": "#f8f8f2" },
    "syntaxComment": { "dark": "comment", "light": "#6272a4" },
    "syntaxKeyword": { "dark": "pink", "light": "pink" }
    // ... ~40 properties total
  }
}
```

**Key Differences:**
- TUI uses `defs` for color definitions and references them by name
- TUI uses per-color dark/light objects
- TUI has ~40 properties vs GUI's ~150 tokens
- TUI has no scale generation - all colors are manually defined

---

## VS Code Theme Ecosystem Context

The themes implemented in OpenCode's GUI are part of a broader VS Code theme ecosystem. Understanding this context helps explain design decisions:

### Popular VS Code Theme Repositories

| Theme | GitHub | Downloads | Description |
|-------|--------|-----------|-------------|
| **Dracula** | [`dracula/theme`](https://github.com/dracula/theme) | 15M+ | One of the most popular themes, featuring purple/violet accent colors |
| **Catppuccin** | [`catppuccin/vscode`](https://github.com/catppuccin/vscode) | 5M+ | Soothing pastel theme with 4 variants (latte, frappe, macchiato, mocha) |
| **Tokyo Night** | [`enkia/tokyo-night-vscode-theme`](https://github.com/enkia/tokyo-night-vscode-theme) | 8M+ | Inspired by VS Code's Night Owl, featuring Japanese aesthetics |
| **Nord** | [`nordtheme/vscode`](https://github.com/nordtheme/vscode) | 4M+ | Arctic-inspired color palette with cool blues |
| **One Dark Pro** | [`binaryify/onedarkpro.vscode`](https://github.com/binaryify/onedarkpro.vscode) | 20M+ | Atom's One Dark theme ported to VS Code |
| **Shades of Purple** | [`ahmadawais/shades-of-purple-vscode`](https://github.com/ahmadawais/shades-of-purple-vscode) | 3M+ | Vibrant purple theme with gold accents |

### VS Code Theme Color Reference

VS Code uses a comprehensive theme token system defined at [`code.visualstudio.com/api/references/theme-color`](https://code.visualstudio.com/api/references/theme-color). The API defines color tokens for:

- **Workbench colors**: Activity bar, sidebar, panel, editor groups
- **Editor colors**: Gutter, line numbers, minimap, indenting guides
- **Syntax colors**: Keywords, strings, numbers, comments, types
- **Integrated terminal colors**: Foreground, background, ANSI escape sequences
- **Notification and peek view colors**

OpenCode's GUI theme system simplifies this by focusing on UI components rather than full editor syntax highlighting, making it more portable across different editor implementations.

### Theme Design Principles

From examining the popular VS Code themes, several patterns emerge:

1. **Seed-based palettes**: Most modern themes start with a primary accent color and derive supporting colors
2. **Consistent contrast**: WCAG AA compliance for accessibility
3. **Syntax token coverage**: 20-30 syntax token types for language support
4. **Dark/light variants**: Many themes now offer both modes with different seed colors

OpenCode's theme system follows these patterns with:
- 9 seed colors (neutral, primary, success, warning, error, info, interactive, diffAdd, diffDelete)
- ~150 tokens covering UI components
- Per-variant seed colors for dark/light modes

### Color Space Considerations

VS Code themes traditionally use sRGB hex colors. OpenCode's use of OKLCH represents a modern approach:

- **OKLCH advantages**: Perceptually uniform colors, wider gamut support, easier gradient generation
- **Browser support**: OKLCH is now supported in all major browsers (Chrome 111+, Firefox 113+, Safari 16.4+)
- **Fallback**: Colors are converted to sRGB hex for maximum compatibility

### Theme Distribution Formats

VS Code themes are distributed as:
- **VSIX packages**: Extension marketplace format
- **JSON theme files**: `.tmTheme` (TextMate) or `.json` (VS Code native)
- **Workbench icons**: Separate icon theme packages

OpenCode's themes use a custom JSON schema (`https://opencode.ai/desktop-theme.json`) optimized for its component library rather than matching VS Code's token format.

---

## Available GUI Themes

Located in [`packages/ui/src/theme/themes/`](packages/ui/src/theme/themes/):

| Theme | File |
|-------|------|
| OC-1 (Default) | [`oc-1.json`](packages/ui/src/theme/themes/oc-1.json) |
| Dracula | [`dracula.json`](packages/ui/src/theme/themes/dracula.json) |
| Tokyo Night | [`tokyonight.json`](packages/ui/src/theme/themes/tokyonight.json) |
| Nord | [`nord.json`](packages/ui/src/theme/themes/nord.json) |
| Catppuccin | [`catppuccin.json`](packages/ui/src/theme/themes/catppuccin.json) |
| Ayu | [`ayu.json`](packages/ui/src/theme/themes/ayu.json) |
| Monokai | [`monokai.json`](packages/ui/src/theme/themes/monokai.json) |
| Solarized | [`solarized.json`](packages/ui/src/theme/themes/solarized.json) |
| One Dark Pro | [`onedarkpro.json`](packages/ui/src/theme/themes/onedarkpro.json) |
| Shades of Purple | [`shadesofpurple.json`](packages/ui/src/theme/themes/shadesofpurple.json) |

---

## Theme Registration

Themes are exported from [`packages/ui/src/theme/default-themes.ts`](packages/ui/src/theme/default-themes.ts:1):

```typescript
export {
  DEFAULT_THEMES,
  oc1Theme,
  tokyonightTheme,
  draculaTheme,
  monokaiTheme,
  solarizedTheme,
  nordTheme,
  catppuccinTheme,
  ayuTheme,
  oneDarkProTheme,
  shadesOfPurpleTheme,
} from "./default-themes"
```

---

## Why These Systems Are Different

1. **Different Rendering Targets**
   - GUI: Web technologies (HTML/CSS) - CSS Custom Properties are native
   - TUI: Terminal emulator - Direct ANSI codes or RGB values

2. **Color Gamut Requirements**
   - GUI: Can use wide-gamut colors (OKLCH provides this)
   - TUI: Limited to terminal's color capabilities (often 256 colors max)

3. **Token Granularity**
   - GUI: ~150 tokens for fine-grained control across many component types
   - TUI: ~40 properties sufficient for terminal display

4. **Scale Generation**
   - GUI: Automatic scale generation from seeds ensures consistency
   - TUI: Manual color definitions allow precise control per property

---

## Conclusion

The desktop GUI theme system is a sophisticated, modern implementation using:
- **OKLCH color space** for perceptual uniformity
- **CSS Custom Properties** for runtime theming
- **Seed-based scale generation** for color consistency
- **150+ tokens** for fine-grained component styling

The TUI/CLI theme system is simpler, using:
- **Direct RGBA/Hex colors**
- **Color reference definitions** for reuse
- **~40 properties** for terminal display

These systems are architecturally incompatible for direct sharing but can be bridged through a conversion tool that maps TUI color definitions to GUI seed colors and token overrides.
