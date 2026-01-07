# TUI/CLI vs GUI Theme Comparison & Migration Plan

## Executive Summary

| System | Theme Count | Location | Missing from Other |
|--------|-------------|----------|-------------------|
| **TUI/CLI** | 32 themes | [`packages/opencode/src/cli/cmd/tui/context/theme/`](packages/opencode/src/cli/cmd/tui/context/theme/) | 2 themes (oc-1, shadesofpurple) |
| **GUI** | 10 themes | [`packages/ui/src/theme/themes/`](packages/ui/src/theme/themes/) | 38 themes |

**Goal**: Achieve feature parity with 50 unified themes across both platforms.

---

## Current Theme Inventory

### TUI/CLI Themes (32)
```
aura.json, ayu.json, catppuccin.json, catppuccin-frappe.json, catppuccin-macchiato.json,
cobalt2.json, cursor.json, dracula.json, everforest.json, flexoki.json, github.json,
gruvbox.json, kanagawa.json, lucent-orng.json, material.json, matrix.json, mercury.json,
monokai.json, nightowl.json, nord.json, one-dark.json, opencode.json, orng.json,
osaka-jade.json, palenight.json, rosepine.json, solarized.json, synthwave84.json,
tokyonight.json, vercel.json, vesper.json, zenburn.json
```

### GUI Themes (10)
```
ayu.json, catppuccin.json, dracula.json, monokai.json, nord.json, oc-1.json,
onedarkpro.json, shadesofpurple.json, solarized.json, tokyonight.json
```

---

## Theme Gap Analysis

### TUI-Only Themes (38) → Add to GUI

| # | Theme | Priority | Difficulty | ETA | Notes |
|---|-------|----------|------------|-----|-------|
| 1 | **github** | **Critical** | Low | 2h | GitHub colors, very popular |
| 2 | **one-dark** | **Critical** | Low | 2h | Atom's most popular |
| 3 | **gruvbox** | **Critical** | Medium | 4h | Retro/vintage, highly requested |
| 4 | **nightowl** | High | Medium | 4h | Sarah Drasner's popular theme |
| 5 | **kanagawa** | High | Medium | 4h | Japanese-inspired, visually stunning |
| 6 | **cursor** | High | Medium | 3h | AI editor theme, highly requested |
| 7 | **cobalt2** | High | Medium | 3h | Wes Bos's popular theme |
| 8 | **aura** | High | Medium | 3h | Modern, ethereal aesthetic |
| 9 | **material** | Medium | Low | 2h | Google Design colors |
| 10 | **catppuccin-frappe** | Medium | Low | 1h | Catppuccin variant (base exists) |
| 11 | **catppuccin-macchiato** | Medium | Low | 1h | Catppuccin variant (base exists) |
| 12 | **everforest** | Medium | Medium | 3h | Nature-inspired, easy on eyes |
| 13 | **flexoki** | Medium | Medium | 3h | Ink-based, excellent contrast |
| 14 | **vercel** | Medium | Low | 2h | Vercel brand colors |
| 15 | **rosepine** | Medium | Medium | 3h | Modern, pastel aesthetic |
| 16 | **osaka-jade** | Medium | Medium | 3h | Japanese-inspired |
| 17 | **github-purple** | Medium | Medium | 3h | GitHub with purple accent |
| 18 | **moon-purple** | Medium | Medium | 3h | Purple moon aesthetic |
| 19 | **purple-time** | Medium | Medium | 3h | Purple timepiece theme |
| 20 | **modern-purple** | Medium | Medium | 3h | Modern purple design |
| 21 | **pretty-purple** | Medium | Medium | 3h | Elegant purple theme |
| 22 | **purple-night** | Medium | Medium | 3h | Purple night sky |
| 23 | **purple-vampire** | Medium | Medium | 3h | Dark purple gothic |
| 24 | **midnight-purple** | Medium | Medium | 3h | Midnight purple tones |
| 25 | **void-purple** | Medium | Medium | 3h | Deep void purple |
| 26 | **space-purple** | Medium | Medium | 3h | Cosmic purple space |
| 27 | **solarized-purple** | Medium | Medium | 3h | Solarized with purple |
| 28 | **lucent-orng** | Low | Medium | 3h | Bright orange theme |
| 29 | **mercury** | Low | Low | 1h | Clean/minimal |
| 30 | **matrix** | Low | Low | 1h | Classic matrix green |
| 31 | **orng** | Low | Medium | 3h | Orange variant |
| 32 | **palenight** | Low | Medium | 3h | One Dark variant |
| 33 | **synthwave84** | Low | Medium | 4h | Retro wave aesthetic |
| 34 | **vesper** | Low | Medium | 3h | Dark, muted |
| 35 | **zenburn** | Low | Medium | 3h | Low-contrast, comfortable |
| 36 | **abyss** | Low | Medium | 3h | Deep blue/black VS Code theme |
| 37 | **mermaid** | Low | Medium | 3h | Blue/aqua color scheme |
| 38 | **kimbie** | Low | Medium | 3h | Orange/gold warm theme |

### GUI-Only Themes (2) → Add to TUI/CLI

| # | Theme | Priority | Difficulty | ETA | Notes |
|---|-------|----------|------------|-----|-------|
| 1 | **oc-1** | **Critical** | Medium | 4h | OpenCode default theme - Brand identity |
| 2 | **shadesofpurple** | Medium | Medium | 4h | Popular VS Code theme |

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

#### 1.1 Create Theme Conversion Tool

**File**: `script/convert-theme.ts`

```typescript
import { hexToOklch, oklchToHex, generateScale, generateNeutralScale } from '../packages/ui/src/theme/color'

interface TuiTheme {
  defs: Record<string, string>
  theme: Record<string, TuiColorValue>
}

interface TuiColorValue {
  dark?: string
  light?: string
} | string | number

interface GuiTheme {
  $schema: string
  name: string
  id: string
  light: {
    seeds: ThemeSeedColors
    overrides: Record<string, string>
  }
  dark: {
    seeds: ThemeSeedColors
    overrides: Record<string, string>
  }
}

interface ThemeSeedColors {
  neutral: string
  primary: string
  success: string
  warning: string
  error: string
  info: string
  interactive: string
  diffAdd: string
  diffDelete: string
}

function resolveTuiColor(tuiTheme: TuiTheme, colorValue: TuiColorValue, mode: 'dark' | 'light'): string {
  if (typeof colorValue === 'string') {
    if (colorValue.startsWith('#')) return colorValue
    if (tuiTheme.defs[colorValue]) return tuiTheme.defs[colorValue]
    // Fallback to dark mode
    if (typeof tuiTheme.theme[colorValue] === 'object') {
      return (tuiTheme.theme[colorValue] as any).dark || colorValue
    }
  }
  if (typeof colorValue === 'object' && colorValue[mode]) {
    return colorValue[mode]
  }
  return '#000000'
}

export function convertTuiToGui(tuiTheme: TuiTheme, name: string, id: string): GuiTheme {
  // Extract seeds for dark mode (usually more distinct)
  const seeds: ThemeSeedColors = {
    neutral: resolveTuiColor(tuiTheme, tuiTheme.theme.background as any, 'dark'),
    primary: resolveTuiColor(tuiTheme, tuiTheme.theme.primary as any, 'dark'),
    secondary: resolveTuiColor(tuiTheme, tuiTheme.theme.secondary as any, 'dark'),
    success: resolveTuiColor(tuiTheme, tuiTheme.theme.success as any, 'dark'),
    warning: resolveTuiColor(tuiTheme, tuiTheme.theme.warning as any, 'dark'),
    error: resolveTuiColor(tuiTheme, tuiTheme.theme.error as any, 'dark'),
    info: resolveTuiColor(tuiTheme, tuiTheme.theme.info as any, 'dark'),
    interactive: resolveTuiColor(tuiTheme, tuiTheme.theme.primary as any, 'dark'),
    diffAdd: resolveTuiColor(tuiTheme, tuiTheme.theme.diffAdded as any, 'dark'),
    diffDelete: resolveTuiColor(tuiTheme, tuiTheme.theme.diffRemoved as any, 'dark'),
  }

  // Generate overrides for both modes
  const lightOverrides = generateOverrides(tuiTheme, 'light')
  const darkOverrides = generateOverrides(tuiTheme, 'dark')

  return {
    $schema: 'https://opencode.ai/desktop-theme.json',
    name,
    id,
    light: { seeds, overrides: lightOverrides },
    dark: { seeds, overrides: darkOverrides },
  }
}

function generateOverrides(tuiTheme: TuiTheme, mode: 'dark' | 'light'): Record<string, string> {
  const overrides: Record<string, string> = {}
  
  // Background colors
  overrides['background-base'] = resolveTuiColor(tuiTheme, tuiTheme.theme.background as any, mode)
  overrides['background-weak'] = resolveTuiColor(tuiTheme, tuiTheme.theme.backgroundPanel as any, mode)
  overrides['background-strong'] = resolveTuiColor(tuiTheme, tuiTheme.theme.backgroundElement as any, mode)
  
  // Syntax colors
  const syntaxMap: Record<string, string> = {
    'syntax-comment': 'syntaxComment',
    'syntax-keyword': 'syntaxKeyword',
    'syntax-function': 'syntaxFunction',
    'syntax-variable': 'syntaxVariable',
    'syntax-string': 'syntaxString',
    'syntax-number': 'syntaxNumber',
    'syntax-type': 'syntaxType',
    'syntax-operator': 'syntaxOperator',
    'syntax-punctuation': 'syntaxPunctuation',
  }
  
  for (const [guiKey, tuiKey] of Object.entries(syntaxMap)) {
    if (tuiTheme.theme[tuiKey]) {
      overrides[guiKey] = resolveTuiColor(tuiTheme, tuiTheme.theme[tuiKey] as any, mode)
    }
  }
  
  // Markdown colors
  const markdownMap: Record<string, string> = {
    'markdown-heading': 'markdownHeading',
    'markdown-text': 'markdownText',
    'markdown-link': 'markdownLink',
    'markdown-code': 'markdownCode',
    'markdown-block-quote': 'markdownBlockQuote',
  }
  
  for (const [guiKey, tuiKey] of Object.entries(markdownMap)) {
    if (tuiTheme.theme[tuiKey]) {
      overrides[guiKey] = resolveTuiColor(tuiTheme, tuiTheme.theme[tuiKey] as any, mode)
    }
  }
  
  return overrides
}
```

#### 1.2 Add oc-1 to TUI/CLI

**File**: `packages/opencode/src/cli/cmd/tui/context/theme/oc-1.json`

Create a new TUI theme matching the GUI oc-1 theme colors. Need to extract colors from:
- [`packages/ui/src/theme/themes/oc-1.json`](packages/ui/src/theme/themes/oc-1.json)

#### 1.3 Add shadesofpurple to TUI/CLI

**File**: `packages/opencode/src/cli/cmd/tui/context/theme/shadesofpurple.json`

Create a new TUI theme matching the GUI shadesofpurple theme colors. Need to extract colors from:
- [`packages/ui/src/theme/themes/shadesofpurple.json`](packages/ui/src/theme/themes/shadesofpurple.json)

---

### Phase 2: Critical Themes (Week 2)

Convert and add these high-priority themes to GUI:

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **github** | Convert using script, verify colors, add tests |
| Tue | **one-dark** | Convert, add to default-themes.ts, verify |
| Wed | **gruvbox** | Convert manually (special colors), verify |
| Thu | **nightowl** | Convert, verify |
| Fri | **kanagawa** | Convert, verify |

### Phase 3: High Priority (Week 3)

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **cursor** | Convert, verify |
| Tue | **cobalt2** | Convert, verify |
| Wed | **aura** | Convert, verify |
| Thu | **material** | Convert, verify |
| Fri | **catppuccin variants** | Convert frappe/macchiato |

### Phase 4: Medium Priority (Week 4)

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **everforest** | Convert, verify |
| Tue | **flexoki** | Convert, verify |
| Wed | **vercel** | Convert, verify |
| Thu | **rosepine** | Convert, verify |
| Fri | **osaka-jade** | Convert, verify |

### Phase 5: Lower Priority (Week 5)

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **lucent-orng** | Convert, verify |
| Tue | **mercury** | Convert, verify |
| Wed | **matrix** | Convert, verify |
| Thu | **orng** | Convert, verify |
| Fri | **palenight** | Convert, verify |

### Phase 6: Purple Themes (Week 6)

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **github-purple** | Convert, verify |
| Tue | **moon-purple** | Convert, verify |
| Wed | **purple-time** | Convert, verify |
| Thu | **modern-purple** | Convert, verify |
| Fri | **pretty-purple** | Convert, verify |

### Phase 7: More Purple Themes (Week 7)

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **purple-night** | Convert, verify |
| Tue | **purple-vampire** | Convert, verify |
| Wed | **midnight-purple** | Convert, verify |
| Thu | **void-purple** | Convert, verify |
| Fri | **space-purple** | Convert, verify |

### Phase 8: Final Purple & Legacy Themes (Week 8)

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **solarized-purple** | Convert, verify |
| Tue | **synthwave84** | Convert, verify |
| Wed | **vesper** | Convert, verify |
| Thu | **zenburn** | Convert, verify |
| Fri | **Testing & Bug Fixes** | Address any issues |

### Phase 9: Legacy VS Code Themes (Week 9)

| Day | Theme | Tasks |
|-----|-------|-------|
| Mon | **abyss** | Convert, verify |
| Tue | **mermaid** | Convert, verify |
| Wed | **kimbie** | Convert, verify |
| Thu | **Documentation** | Update theme docs |
| Fri | **Release Preparation** | Final checks |

---

## Files to Modify

### New Files (6)

| File | Purpose |
|------|---------|
| `script/convert-theme.ts` | Theme conversion utility |
| `packages/opencode/src/cli/cmd/tui/context/theme/oc-1.json` | OpenCode default theme |
| `packages/opencode/src/cli/cmd/tui/context/theme/shadesofpurple.json` | Shades of Purple theme |
| `packages/ui/src/theme/themes/aura.json` | Aura theme |
| `packages/ui/src/theme/themes/cobalt2.json` | Cobalt2 theme |
| ... (38 total new GUI themes) | |

### Modified Files (4)

| File | Changes |
|------|---------|
| `packages/ui/src/theme/default-themes.ts` | Export new themes |
| `packages/ui/src/theme/index.ts` | Export new themes if needed |
| `packages/opencode/src/cli/cmd/tui/context/theme.tsx` | Register oc-1 and shadesofpurple |
| `packages/web/src/content/docs/themes.mdx` | Document all 50 themes |

---

## Testing Plan

### Automated Tests

```typescript
// test/themes.test.ts

describe('Theme Conversion', () => {
  test('converts TUI github theme to GUI format correctly', () => {
    const tuiTheme = await loadTheme('github.json')
    const guiTheme = convertTuiToGui(tuiTheme, 'GitHub', 'github')
    
    expect(guiTheme.id).toBe('github')
    expect(guiTheme.light.seeds.primary).toBeDefined()
    expect(guiTheme.dark.seeds.primary).toBeDefined()
    expect(guiTheme.light.overrides['background-base']).toBeDefined()
  })
  
  test('all converted themes have valid hex colors', async () => {
    const themes = ['github', 'gruvbox', 'nightowl', 'kanagawa', 'cursor']
    
    for (const themeId of themes) {
      const tuiTheme = await loadTheme(`${themeId}.json`)
      const guiTheme = convertTuiToGui(tuiTheme, themeId, themeId)
      
      validateGuiTheme(guiTheme)
    }
  })
  
  test('GUI themes render correctly in browser', async () => {
    // Use Playwright to verify theme rendering
  })
})
```

### Manual Testing Checklist

- [ ] Light mode colors are visible and readable
- [ ] Dark mode colors are visible and readable
- [ ] Syntax highlighting works for major languages
- [ ] Diff colors are distinguishable
- [ ] Markdown rendering is correct
- [ ] Accessibility contrast ratios meet WCAG AA

---

## Rollout Strategy

### Version 1.2.0

1. **Add TUI themes to GUI** (38 themes over 8 weeks)
2. **Add GUI themes to TUI** (2 themes: oc-1, shadesofpurple)
3. **Update theme selector UI** to show all 50 themes
4. **Update documentation** with theme screenshots
5. **Announce** in release notes

### Migration Path

1. **Week 1**: Internal testing of converted themes
2. **Week 2-6**: Gradual rollout of converted themes
3. **Week 9**: Full release with all 50 themes
4. **Ongoing**: Community feedback and refinements

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Color accuracy | High | Manual review of each converted theme |
| Performance | Low | Themes are static, no runtime cost |
| Maintenance | Medium | Unified conversion script reduces drift |
| User confusion | Low | Clear theme names and descriptions |

---

## Success Metrics

- [ ] All 50 themes available in both GUI and TUI
- [ ] Zero critical color rendering issues
- [ ] Theme switch time < 100ms
- [ ] Documentation complete with screenshots
- [ ] Community satisfaction survey > 4/5

---

## Appendix: Theme Color Mapping Reference

### TUI → GUI Token Mapping

| TUI Token | GUI Token | Notes |
|-----------|-----------|-------|
| `background` | `background-base` | |
| `backgroundPanel` | `background-weak` | |
| `backgroundElement` | `background-strong` | |
| `text` | `text-base` | |
| `textMuted` | `text-weak` | |
| `border` | `border-base` | |
| `borderActive` | `border-active` | |
| `borderSubtle` | `border-weak-base` | |
| `syntaxComment` | `syntax-comment` | |
| `syntaxKeyword` | `syntax-keyword` | |
| `syntaxFunction` | `syntax-function` | |
| `syntaxVariable` | `syntax-variable` | |
| `syntaxString` | `syntax-string` | |
| `syntaxNumber` | `syntax-number` | |
| `syntaxType` | `syntax-type` | |
| `syntaxOperator` | `syntax-operator` | |
| `syntaxPunctuation` | `syntax-punctuation` | |
| `diffAdded` | `surface-diff-add-base` | |
| `diffRemoved` | `surface-diff-delete-base` | |
| `markdownHeading` | `markdown-heading` | |
| `markdownText` | `markdown-text` | |
| `markdownLink` | `markdown-link` | |
| `markdownCode` | `markdown-code` | |
| `markdownBlockQuote` | `markdown-block-quote` | |
| `markdownEmph` | `markdown-emph` | |
| `markdownStrong` | `markdown-strong` | |
