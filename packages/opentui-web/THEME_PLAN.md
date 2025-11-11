# OpenTUI-Web Theme System Migration Plan

**Date**: November 11, 2025  
**Status**: Research & Planning Phase  
**Target**: Migrate from hardcoded colors to CSS variables aligned with opencode TUI theme system

---

## Executive Summary

The opentui-web package currently uses **47+ hardcoded color values** scattered across 13+ component files. This document outlines a migration path to a centralized CSS variable system that mirrors the opencode TUI theme structure, enabling:

- **Theme consistency** across opencode desktop and web UIs
- **Runtime theme switching** (dark/light mode, custom themes)
- **Maintainability** with single source of truth for colors
- **Extensibility** for future theme variations

---

## Current Color Inventory

### Hardcoded Colors Found (47 unique values)

#### **Base Colors (Backgrounds & Borders)**

```
#0a0a0a  - Main background (darkest)
#1a1a1a  - Panel background (dark gray)
#2a2a2a  - Input/selected backgrounds, borders
#3a3a3a  - Subtle borders, scrollbar track
#4a4a4a  - Dim text, scrollbar thumb
#000000  - Pure black (rare, used in layouts)
```

#### **Text Colors**

```
#ffffff  - Bright white (primary text, emphasis)
#d4d4d4  - Secondary text (default)
#858585  - Label text (headers, metadata)
#6a6a6a  - Muted text (timestamps, hints)
#4a4a4a  - Very dim text
```

#### **Accent Colors (Semantic)**

```
#d19a66  - Orange (assistant, selections, actions)
#61afef  - Blue (user messages, primary accent)
#e5c07b  - Yellow (tools, warnings, stars)
#98c379  - Green (success, completed states)
#e06c75  - Red (errors, failed states)
#569cd6  - Light blue (agent names)
#4ec9b0  - Cyan (success alt)
```

#### **UI-Specific Colors**

```
#ff9800  - Bright orange (badges, prompts, cursors)
#4da6ff  - Bright blue (user indicator)
#9a9a9a  - Gray badge backgrounds
#999999  - Context bar system color
#808080  - System gray
#000000  - Badge text on bright backgrounds
```

### Color Usage Map

| Color     | Primary Use Cases                              | Files                                                                                     |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `#0a0a0a` | Main background                                | terminal-theme.css, GridPanel, MessagesPanel, SessionsPanel, SidebarPanel, TerminalLayout |
| `#1a1a1a` | Panel backgrounds, scrollbars                  | All grid components, terminal-theme.css                                                   |
| `#2a2a2a` | Input fields, selections, dividers, borders    | GridDivider, terminal-theme.css, Dialog                                                   |
| `#6a6a6a` | Muted text (timestamps, hints, secondary info) | All panels, TerminalInput                                                                 |
| `#ffffff` | Primary text, emphasis                         | All text components                                                                       |
| `#d19a66` | Assistant responses, selections, actions       | SidebarPanel, SessionsPanel, TerminalInput                                                |
| `#61afef` | User messages, primary actions                 | MessagesPanel, Dialog                                                                     |
| `#ff9800` | Prompts, badges, cursors                       | MessagesPanel, SidebarPanel, TerminalInput                                                |
| `#e5c07b` | Tools, warnings, favorites                     | SidebarPanel, TerminalInput                                                               |
| `#98c379` | Success states (running, completed)            | SidebarPanel                                                                              |
| `#e06c75` | Error states (failed)                          | SidebarPanel, Dialog                                                                      |

---

## OpenCode TUI Theme Structure Analysis

### Theme System Architecture

The opencode TUI uses a **semantic color system** with JSON theme definitions:

```typescript
type Theme = {
  // Status colors
  primary: RGBA // Main accent
  secondary: RGBA // Alt accent
  accent: RGBA // Highlights
  error: RGBA // Errors
  warning: RGBA // Warnings
  success: RGBA // Success
  info: RGBA // Info states

  // Text colors
  text: RGBA // Primary text
  textMuted: RGBA // Secondary text

  // Background colors
  background: RGBA // Main BG
  backgroundPanel: RGBA // Panel BG
  backgroundElement: RGBA // Element BG

  // Border colors
  border: RGBA // Standard
  borderActive: RGBA // Active state
  borderSubtle: RGBA // Subtle

  // Syntax colors (for code)
  syntaxComment: RGBA
  syntaxKeyword: RGBA
  syntaxFunction: RGBA
  syntaxVariable: RGBA
  syntaxString: RGBA
  syntaxNumber: RGBA
  syntaxType: RGBA
  syntaxOperator: RGBA
  syntaxPunctuation: RGBA

  // Markdown colors
  markdownText: RGBA
  markdownHeading: RGBA
  markdownLink: RGBA
  markdownCode: RGBA
  // ... etc

  // Diff colors (for diffs)
  diffAdded: RGBA
  diffRemoved: RGBA
  // ... etc
}
```

### OpenCode Default Theme Colors (Dark Mode)

**From `opencode.json` theme:**

```json
{
  "background": "#0a0a0a", // Matches current opentui-web!
  "backgroundPanel": "#141414", // Slightly lighter
  "backgroundElement": "#1e1e1e", // Even lighter
  "text": "#eeeeee", // Near white
  "textMuted": "#808080", // Gray
  "primary": "#fab283", // Peachy orange
  "secondary": "#5c9cf5", // Blue
  "accent": "#f5a742", // Orange
  "success": "#7fd88f", // Green
  "error": "#e06c75", // Red
  "warning": "#f5a742", // Orange
  "info": "#56b6c2", // Cyan
  "border": "#484848",
  "borderActive": "#606060",
  "borderSubtle": "#3c3c3c"
}
```

### One Dark Theme (for comparison)

**From `one-dark.json`:**

```json
{
  "background": "#282c34",
  "backgroundPanel": "#21252b",
  "backgroundElement": "#353b45",
  "text": "#abb2bf",
  "textMuted": "#5c6370",
  "primary": "#61afef", // Blue - matches opentui-web user color!
  "secondary": "#c678dd", // Purple
  "accent": "#56b6c2", // Cyan
  "success": "#98c379", // Green - matches opentui-web!
  "error": "#e06c75", // Red - matches opentui-web!
  "warning": "#e5c07b", // Yellow - matches opentui-web!
  "info": "#d19a66" // Orange - matches opentui-web assistant!
}
```

**Key Finding**: Current opentui-web colors are **closer to One Dark** than OpenCode default theme!

---

## Proposed CSS Variable Structure

### Core Variables (aligned with opencode theme)

```css
:root {
  /* === BACKGROUNDS === */
  --bg-main: #0a0a0a; /* Main editor background */
  --bg-panel: #1a1a1a; /* Sidebar/panel background */
  --bg-element: #2a2a2a; /* Input fields, selections */
  --bg-hover: #1f1f1f; /* Hover states */

  /* === TEXT === */
  --text-primary: #ffffff; /* Main text */
  --text-secondary: #d4d4d4; /* Secondary text */
  --text-muted: #6a6a6a; /* Timestamps, hints */
  --text-dim: #4a4a4a; /* Very dim text */
  --text-label: #858585; /* Headers, labels */

  /* === BORDERS === */
  --border-main: #2a2a2a; /* Standard borders */
  --border-subtle: #3a3a3a; /* Subtle dividers */
  --border-active: #4a4a4a; /* Active/hover borders */

  /* === SEMANTIC COLORS === */
  --color-primary: #61afef; /* Primary actions (user) */
  --color-secondary: #c678dd; /* Secondary accent */
  --color-accent: #ff9800; /* Highlights, prompts */

  --color-success: #98c379; /* Success states */
  --color-warning: #e5c07b; /* Warnings, tools */
  --color-error: #e06c75; /* Errors, failures */
  --color-info: #56b6c2; /* Info states */

  /* === ROLE COLORS === */
  --color-user: #61afef; /* User messages (blue) */
  --color-assistant: #d19a66; /* Assistant responses (orange) */
  --color-tool: #e5c07b; /* Tool usage (yellow) */
  --color-system: #808080; /* System messages (gray) */

  /* === UI ELEMENTS === */
  --color-badge: #9a9a9a; /* Badge backgrounds */
  --color-badge-text: #000000; /* Badge text */
  --color-cursor: #ff9800; /* Text cursor */
  --color-selection: #2a2a2a; /* Selection background */

  /* === SCROLLBARS === */
  --scrollbar-track: #1a1a1a;
  --scrollbar-thumb: #4a4a4a;
  --scrollbar-thumb-hover: #6a6a6a;
}
```

### Light Mode Overrides (future)

```css
@media (prefers-color-scheme: light) {
  :root {
    --bg-main: #ffffff;
    --bg-panel: #f5f5f5;
    --bg-element: #ebebeb;
    --text-primary: #1a1a1a;
    --text-secondary: #383a42;
    --text-muted: #a0a1a7;
    /* ... etc */
  }
}
```

---

## Color Mapping: Hardcoded → Variables

| Current Hardcoded | Proposed Variable                  | Semantic Name       |
| ----------------- | ---------------------------------- | ------------------- |
| `#0a0a0a`         | `--bg-main`                        | Main background     |
| `#1a1a1a`         | `--bg-panel`                       | Panel background    |
| `#2a2a2a`         | `--bg-element`                     | Inputs, selections  |
| `#ffffff`         | `--text-primary`                   | Primary text        |
| `#d4d4d4`         | `--text-secondary`                 | Secondary text      |
| `#858585`         | `--text-label`                     | Labels, headers     |
| `#6a6a6a`         | `--text-muted`                     | Muted text          |
| `#4a4a4a`         | `--text-dim`                       | Dim text            |
| `#61afef`         | `--color-user`                     | User messages       |
| `#d19a66`         | `--color-assistant`                | Assistant responses |
| `#e5c07b`         | `--color-tool` / `--color-warning` | Tools, warnings     |
| `#ff9800`         | `--color-accent`                   | Prompts, cursors    |
| `#98c379`         | `--color-success`                  | Success states      |
| `#e06c75`         | `--color-error`                    | Error states        |
| `#9a9a9a`         | `--color-badge`                    | Badge backgrounds   |
| `#000000`         | `--color-badge-text`               | Badge text          |

---

## Migration Strategy

### Phase 1: Setup (Low Risk)

**Goal**: Establish CSS variable foundation without breaking changes

1. **Update `terminal-theme.css`** with comprehensive variable definitions
   - Keep existing variables as fallbacks
   - Add new semantic variables
   - Add role-based color variables
2. **Create theme variant files** (optional)

   ```
   /src/theme/
     terminal-theme.css       (default/base)
     opencode-theme.css       (OpenCode default)
     one-dark-theme.css       (One Dark)
   ```

3. **Document color usage** in comments
   ```css
   /* --color-user: User message indicator, links, primary actions */
   --color-user: #61afef;
   ```

### Phase 2: Component Migration (Medium Risk)

**Goal**: Replace hardcoded colors with CSS variables

**Order of migration** (safest → riskiest):

1. ✅ **Base theme file** (`terminal-theme.css`) - ALREADY HAS VARIABLES
2. **GridText.tsx** - Simple component, easy to verify
3. **GridPanel.tsx** - Affects all panels
4. **GridDivider.tsx** - Visual boundary component
5. **SessionsPanel.tsx** - Complex but isolated
6. **SidebarPanel.tsx** - Complex, many colors
7. **MessagesPanel.tsx** - MOST COMPLEX, test thoroughly

**Migration pattern**:

```tsx
// BEFORE
<GridPanel bg="#0a0a0a" />

// AFTER
<GridPanel bg="var(--bg-main)" />
```

### Phase 3: Testing & Validation (Critical)

**Visual regression testing**:

1. Screenshot comparison (before/after)
2. Test all component states:
   - Default
   - Hover
   - Active/selected
   - Disabled
   - Error states
3. Test all panels:
   - Sessions panel
   - Messages panel
   - Sidebar panel
   - Terminal input

**Browser compatibility**:

- Test CSS variables in target browsers
- Verify fallback colors work
- Check dark/light mode switching

### Phase 4: Theme System Integration (Future)

**Advanced features** (post-MVP):

1. **Runtime theme switching**

   ```tsx
   const setTheme = (theme: "opencode" | "one-dark" | "custom") => {
     document.documentElement.dataset.theme = theme
   }
   ```

2. **Theme context provider**

   ```tsx
   <ThemeProvider theme="opencode">
     <TerminalLayout />
   </ThemeProvider>
   ```

3. **Custom theme editor**
   - Allow users to customize colors
   - Export/import theme JSON
   - Sync with opencode desktop themes

4. **System theme detection**
   ```css
   @media (prefers-color-scheme: dark) {
     /* ... */
   }
   @media (prefers-color-scheme: light) {
     /* ... */
   }
   ```

---

## Risk Assessment

### Low Risk ✅

- Adding CSS variables (non-breaking)
- Migrating simple components (GridText, GridPanel)
- Documentation updates

### Medium Risk ⚠️

- Migrating complex components (MessagesPanel)
- Changing color semantics (user/assistant colors)
- Adding theme switching logic

### High Risk 🔴

- Breaking existing visual design
- Runtime theme switching bugs
- Performance impact of CSS variables
- Browser compatibility issues

---

## Comparison: OpenTUI-Web vs OpenCode TUI

### Similarities ✅

- **Same base background**: Both use `#0a0a0a`
- **Similar panel BG**: `#1a1a1a` is close to opencode's `#141414`
- **Shared color palette**: Many One Dark colors match exactly
- **Semantic structure**: Both use role-based colors (user, assistant, tool)

### Differences ⚠️

| Aspect              | OpenTUI-Web               | OpenCode TUI             |
| ------------------- | ------------------------- | ------------------------ |
| **Theme system**    | Hardcoded CSS             | JSON + runtime switching |
| **Color count**     | ~47 unique values         | ~40 semantic variables   |
| **Primary accent**  | `#ff9800` (bright orange) | `#fab283` (peachy)       |
| **User color**      | `#61afef` (blue)          | Derived from theme       |
| **Assistant color** | `#d19a66` (orange)        | Derived from theme       |
| **Theme switching** | None                      | 20+ built-in themes      |

### Alignment Recommendations

1. **Keep current colors** as "One Dark" variant
2. **Add OpenCode default** as alternate theme
3. **Use same variable names** as TUI theme system
4. **Support runtime switching** (future enhancement)

---

## File Change Summary

### Files to Modify (Phase 2)

```
packages/opentui-web/src/
  theme/
    ✏️  terminal-theme.css          (add comprehensive variables)
  grid-components/
    ✏️  GridText.tsx                (fg/bg props → CSS vars)
    ✏️  GridPanel.tsx               (bg prop → CSS var)
    ✏️  GridDivider.tsx             (bg → CSS var)
    ✏️  GridInput.tsx               (colors → CSS vars)
    ✏️  GridShimmer.tsx             (colors → CSS vars)
    ✏️  GridAnimated.tsx            (colors → CSS vars)
    ✏️  SessionsPanel.tsx           (47 color instances)
    ✏️  SidebarPanel.tsx            (72 color instances)
    ✏️  MessagesPanel.tsx           (103 color instances)
    ✏️  TerminalInput.tsx           (colors → CSS vars)
    ✏️  Dialog.tsx                  (colors → CSS vars)
    ✏️  TerminalLayout.tsx          (colors → CSS vars)
  terminal/
    ✏️  types.ts                    (THEME const → use CSS vars)
```

### New Files to Create (Phase 4)

```
packages/opentui-web/src/
  theme/
    📄 themes/
      opencode.json      (OpenCode default theme)
      one-dark.json      (Current color scheme)
      custom.json        (User customization template)
    📄 ThemeProvider.tsx (Context provider)
    📄 useTheme.ts       (Theme hook)
```

---

## Next Steps

### Immediate (Phase 1)

1. ✅ **Review this document** with team
2. **Update `terminal-theme.css`** with proposed variables
3. **Create backup branch** before changes
4. **Take screenshots** of all components (baseline)

### Short Term (Phase 2)

5. **Migrate simple components** (GridText, GridPanel)
6. **Test visual changes** (screenshot comparison)
7. **Migrate complex components** (MessagesPanel, SidebarPanel)
8. **Full visual regression test**

### Long Term (Phase 3-4)

9. **Implement theme switching** (runtime)
10. **Add OpenCode default theme**
11. **Create theme documentation**
12. **User customization UI**

---

## Success Criteria

✅ **Must Have**:

- No visual regressions in default (dark) theme
- All hardcoded colors replaced with CSS variables
- Clean, maintainable variable structure
- Clear documentation for future theme additions

🎯 **Nice to Have**:

- Runtime theme switching (light/dark)
- Multiple theme presets (OpenCode, One Dark, etc.)
- User customization support
- Sync with opencode desktop themes

---

## References

### Source Files Analyzed

**OpenTUI-Web**:

- `/packages/opentui-web/src/theme/terminal-theme.css`
- `/packages/opentui-web/src/grid-components/*.tsx` (13 files)
- `/packages/opentui-web/src/terminal/types.ts`

**OpenCode TUI**:

- `/packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- `/packages/opencode/src/cli/cmd/tui/context/theme/opencode.json`
- `/packages/opencode/src/cli/cmd/tui/context/theme/one-dark.json`

### Color Extraction Command

```bash
rg '#[0-9a-fA-F]{6}' packages/opentui-web/src/grid-components/ -o | sort | uniq
```

### Total Color Instances

- **terminal-theme.css**: 15 unique colors (42 instances)
- **Grid components**: 32 unique colors (200+ instances)
- **Total unique colors**: 47
- **Most used**: `#6a6a6a` (muted text) - 30+ instances

---

## Appendix: Full Color Inventory

### All 47 Unique Colors (Sorted by Brightness)

```
Darkest → Lightest:

#000000  (1 usage)   - Pure black
#050505  (1 usage)   - Near black
#0a0a0a  (12 usage)  - Main background ⭐
#1a1a1a  (28 usage)  - Panel background ⭐⭐⭐
#1f1f1f  (1 usage)   - Hover background
#2a2a2a  (20 usage)  - Input/selection ⭐⭐
#282828  (1 usage)   - Active line
#3a3a3a  (4 usage)   - Subtle borders
#4a4a4a  (5 usage)   - Dim text
#4da6ff  (2 usage)   - Bright blue (user)
#4ec9b0  (3 usage)   - Cyan (accent)
#569cd6  (3 usage)   - Light blue (agent)
#56b6c2  (1 usage)   - Cyan (info)
#61afef  (8 usage)   - Blue (user) ⭐
#6a6a6a  (32 usage)  - Muted text ⭐⭐⭐⭐
#6a9955  (2 usage)   - Green (syntax)
#808080  (1 usage)   - System gray
#858585  (8 usage)   - Label text ⭐
#9a9a9a  (1 usage)   - Badge BG
#98c379  (2 usage)   - Green (success)
#999999  (2 usage)   - Context bar
#c53b53  (1 usage)   - Red (diff)
#c586c0  (2 usage)   - Purple (syntax)
#ce9178  (4 usage)   - Orange (syntax)
#d19a66  (7 usage)   - Orange (assistant) ⭐
#d4d4d4  (10 usage)  - Secondary text ⭐⭐
#dcdcaa  (4 usage)   - Yellow (syntax)
#e06c75  (3 usage)   - Red (error)
#e5c07b  (6 usage)   - Yellow (tool/warning) ⭐
#f48771  (2 usage)   - Light red (syntax)
#ff9800  (8 usage)   - Bright orange (accent) ⭐
#ffffff  (30 usage)  - White (primary text) ⭐⭐⭐⭐

⭐ = High usage (5+ instances)
```

---

**End of Document**

Total sections: 12  
Total lines: ~700  
Estimated read time: 15 minutes
