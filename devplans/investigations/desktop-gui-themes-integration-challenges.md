# GUI vs TUI Theme Integration Challenges

## Executive Summary

While making the desktop GUI themes match the TUI/CLI themes is conceptually appealing for consistency, there are **significant architectural, technical, and practical challenges** that make direct integration difficult.

---

## Key Challenges

### 1. **Fundamental Color Model Mismatch**

| Aspect | Desktop GUI | TUI/CLI |
|--------|-------------|---------|
| Color Space | OKLCH (perceptually uniform) | RGB (device-dependent) |
| Color Format | Hex + CSS variables | RGBA + ANSI codes |
| Output Target | Web browser CSS engine | Terminal emulator |

**Problem**: OKLCH provides perceptual uniformity across hues, while RGB is device-dependent. Converting between them loses the "perceptually uniform" property that makes OKLCH valuable.

### 2. **Token/Semantic Mismatch**

The GUI has ~150 CSS tokens with semantic names like:
- `--background-base`, `--surface-raised-stronger-hover`, `--text-on-interactive-weak`

The TUI has ~40 color properties with different names like:
- `background`, `backgroundElement`, `borderSubtle`, `syntaxComment`

**Problem**: There's no direct 1:1 mapping. The GUI tokens are much more granular and specific to component states.

### 3. **Dark/Light Mode Architecture**

```typescript
// Desktop GUI: Per-theme variants
{
  "light": { "seeds": {...}, "overrides": {...} },
  "dark": { "seeds": {...}, "overrides": {...} }
}

// TUI/CLI: Per-color mode objects
{
  "primary": { "dark": "purple", "light": "purple" },
  "text": { "dark": "foreground", "light": "#282a36" }
}
```

**Problem**: The structures are incompatible. GUI uses separate theme objects; TUI uses per-color mode objects.

### 4. **Procedural vs Declarative Generation**

| Desktop GUI | TUI/CLI |
|-------------|---------|
| Seed colors → generate scales | Direct color assignment |
| Automatic 12-step scales | Manual palette design |
| Alpha blending from base | Pre-blended RGBA values |
| Math-based color relationships | Designer-defined relationships |

**Problem**: The GUI's procedural approach creates consistent relationships between colors. Simply copying final hex values would lose these relationships and make future updates difficult.

### 5. **Rendering Environment Differences**

| Factor | Desktop GUI | TUI/CLI |
|--------|-------------|---------|
| Color Depth | 24-bit true color | 256-color ANSI (usually) |
| Color Profile | sRGB (browser-managed) | Terminal's color palette |
| Anti-aliasing | Subpixel (ClearType) | No anti-aliasing |
| Transparency | Full alpha support | Limited/none |
| Compositing | CSS blending modes | No compositing |

**Problem**: Terminal emulators have different color rendering characteristics. Colors that look good in a browser may look different in a terminal.

### 6. **Scale Generation Differences**

The GUI's [`generateScale()`](packages/ui/src/theme/color.ts:99) creates 12-step scales:
```typescript
const lightSteps = isDark
  ? [0.15, 0.18, 0.22, 0.26, 0.32, 0.38, 0.46, 0.56, base.l, base.l - 0.05, 0.75, 0.93]
  : [0.99, 0.97, 0.94, 0.9, 0.85, 0.79, 0.72, 0.64, base.l, base.l + 0.05, 0.45, 0.25]
```

TUI themes define colors directly without procedural generation.

**Problem**: A GUI theme designed with 12-step scales won't map cleanly to TUI's direct color assignments.

---

## Specific Token Mapping Issues

### Example: Syntax Colors

**GUI** ([`resolve.ts:244-262`](packages/ui/src/theme/resolve.ts:244)):
```typescript
tokens["syntax-comment"] = "var(--text-weak)"
tokens["syntax-string"] = isDark ? "#00ceb9" : "#006656"
tokens["syntax-keyword"] = "var(--text-weak)"
tokens["syntax-primitive"] = isDark ? "#ffba92" : "#fb4804"
```

**TUI** ([`dracula.json:182-217`](packages/opencode/src/cli/cmd/tui/context/theme/dracula.json:182)):
```json
"syntaxComment": { "dark": "comment", "light": "#6272a4" },
"syntaxKeyword": { "dark": "pink", "light": "pink" },
"syntaxString": { "dark": "yellow", "light": "yellow" }
```

**Issues**:
- GUI uses CSS variable references (e.g., `var(--text-weak)`) that resolve to different values
- GUI has conditional values (`isDark ? ... : ...`)
- GUI has tokens TUI doesn't have (e.g., `syntax-primitive`, `syntax-regexp`)

### Example: Surface Colors

**GUI** ([`resolve.ts:26-51`](packages/ui/src/theme/resolve.ts:26)):
```typescript
tokens["surface-base"] = neutralAlpha[1]
tokens["surface-raised-base"] = neutralAlpha[0]
tokens["surface-float-base"] = isDark ? neutral[0] : neutral[11]
tokens["surface-brand-base"] = primary[8]
```

**TUI** ([`dracula.json:58-65`](packages/opencode/src/cli/cmd/tui/context/theme/dracula.json:58)):
```json
"backgroundPanel": { "dark": "#21222c", "light": "#e8e8e2" },
"backgroundElement": { "dark": "currentLine", "light": "#d8d8d2" }
```

**Issues**:
- GUI has 10+ surface variants; TUI has 3
- GUI uses alpha blending; TUI uses pre-blended colors
- GUI names are more granular (`surface-raised-stronger-hover` vs `backgroundElement`)

---

## Practical Integration Approaches

### Option 1: Unified Theme Format (Recommended)

Create a **unified theme definition format** that can compile to both GUI CSS and TUI RGBA:

```typescript
// unified-theme.schema.json
{
  "$schema": "https://opencode.ai/unified-theme.json",
  "id": "tokyonight",
  "name": "Tokyo Night",
  "colors": {
    "neutral": "#e1e2e7",  // Seed for GUI scale generation
    "primary": "#2e7de9",
    // ... 9 seed colors
  },
  "mappings": {
    // TUI-specific overrides (if needed)
    "background": { "dark": "#0f111a", "light": "#e1e2e7" }
  }
}
```

**Pros**: Single source of truth, consistent theming
**Cons**: Significant refactoring, backward compatibility issues

### Option 2: Theme Converter Script

Write a **conversion script** that transforms TUI themes to GUI format:

```typescript
// script/convert-tui-theme.ts
function convertTuiToGui(tuiTheme: TuiTheme): DesktopTheme {
  const seeds = extractSeeds(tuiTheme)
  return {
    id: tuiTheme.id,
    name: tuiTheme.name,
    light: { seeds, overrides: mapColors(tuiTheme, 'light') },
    dark: { seeds, overrides: mapColors(tuiTheme, 'dark') }
  }
}
```

**Pros**: Preserves both systems, automatic conversion
**Cons**: Loss of GUI-specific optimizations, potential visual discrepancies

### Option 3: Shared Color Palette

Define a **shared color palette** that both systems reference:

```typescript
// packages/theme/palette.ts
export const TOKYONIGHT_PALETTE = {
  primary: "#7aa2f7",
  secondary: "#bb9af7",
  success: "#9ece6a",
  // ...
} as const
```

**Pros**: Shared foundation, easy to add themes
**Cons**: Doesn't solve procedural vs declarative gap

---

## Recommended Path Forward

### Short-term (Low Effort)

1. **Document the mapping** between GUI and TUI tokens
2. **Add conversion utilities** for common color transformations
3. **Create a theme comparison tool** to visualize differences

### Medium-term (Moderate Effort)

1. **Unified schema**: Design a schema that supports both systems
2. **CI validation**: Ensure theme files pass both schema validations
3. **Visual regression tests**: Catch visual discrepancies between platforms

### Long-term (High Effort)

1. **Refactor to unified theme format**
2. **Migrate existing themes** to new format
3. **Update documentation** for theme creation

---

## Conclusion

Directly matching GUI themes to TUI themes is **not recommended** due to:

1. **Different color models** (OKLCH vs RGB)
2. **Different token systems** (~150 vs ~40 properties)
3. **Different dark/light mode architectures**
4. **Different rendering environments** (browser vs terminal)
5. **Different color generation approaches** (procedural vs declarative)

**Better approach**: Create a unified theme definition format that compiles to both systems, preserving the unique characteristics of each while ensuring visual consistency where possible.

---

## Files Reference

| File | Description |
|------|-------------|
| [`packages/ui/src/theme/color.ts`](packages/ui/src/theme/color.ts:1) | Color conversion utilities |
| [`packages/ui/src/theme/resolve.ts`](packages/ui/src/theme/resolve.ts:1) | Token resolution logic |
| [`packages/ui/src/theme/themes/tokyonight.json`](packages/ui/src/theme/themes/tokyonight.json:1) | GUI Tokyo Night theme |
| [`packages/opencode/src/cli/cmd/tui/context/theme.tsx`](packages/opencode/src/cli/cmd/tui/context/theme.tsx:1) | TUI theme provider |
| [`packages/opencode/src/cli/cmd/tui/context/theme/dracula.json`](packages/opencode/src/cli/cmd/tui/context/theme/dracula.json:1) | TUI Dracula theme |
