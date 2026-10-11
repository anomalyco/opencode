---
name: OpenCode UI Theming
description: Use when you write CSS or Tailwind that must differ between light and dark mode, add a color-scheme selector, use useTheme or ThemeProvider, edit theme JSON in packages/ui/src/theme/themes, or test UI against the OpenCode themes.
---

# OpenCode UI Theming

> Design rules in this skill come from the design system owner. Fix facts (paths, prop names, token names) directly. To change a rule, record design feedback with `/design-feedback`.

OpenCode has 36 themes (`packages/ui/src/theme/themes/*.json`), each with a light and a dark variant. The default theme is `oc-2` ("OpenCode"). Components almost never need scheme-specific CSS: the v2 semantic tokens already switch. Choose tokens with the `opencode-ui-tokens` skill.

## How themes reach the page

`ThemeProvider` (`@opencode/ui/theme`, implemented in `src/theme/context.tsx`):

1. Reads the theme ID (`localStorage["opencode-theme-id"]`, default `oc-2`) and the scheme (`localStorage["opencode-color-scheme"]`: `"light"`, `"dark"`, or `"system"`). `"system"` follows the OS through `matchMedia` in JavaScript.
2. Resolves the variant to v1 and v2 token values and writes them into `<style id="oc-theme">` as `:root { ... }`.
3. Sets `html[data-theme="<theme-id>"]` (for example `dracula`) and `html[data-color-scheme="light" | "dark"]` (always the resolved scheme, never `"system"`).

Before JavaScript runs, `src/styles/tokens/theme.css` supplies the OC-2 values for `:root`, `[data-color-scheme="light"]`, and `[data-color-scheme="dark"]`.

`useTheme()` returns `themeId()`, `colorScheme()`, `mode()` (resolved `"light" | "dark"`), `ids()`, `name(id)`, `setTheme(id)`, `setColorScheme(scheme)`, `previewTheme(id)`, `registerTheme(theme)`, and `loadThemes()`.

## How a theme resolves

A theme file (`DesktopTheme` in `src/theme/types.ts`, schema `src/theme/desktop-theme.schema.json`) gives each variant a `palette` of seed colors: `neutral`, `ink`, `primary`, `success`, `warning`, `error`, `info`, and optional `accent`, `interactive`, `diffAdd`, `diffDelete`. Legacy themes use `seeds` instead.

`resolveThemeVariantV2` (`src/theme/v2/resolve.ts`) then:

1. Builds OKLCH primitive ramps, steps `100` (lightest) to `1200`: `interactive` → `--v2-blue-*`, `success` → green, `warning` → yellow, `error` → red, `accent` → purple, `info` → pink, derived orange and cyan, and `neutral` → `ink` → `--v2-grey-*`.
2. Maps semantic tokens to primitives with `mapV2Semantics` (`src/theme/v2/mapping.ts`).
3. Derives text and icon levels from `ink` with contrast checks (`src/theme/v2/foreground.ts`).
4. Applies the variant's `v2Overrides` last. OC-2 stores its full token set there (generated from `theme.css` by `bun run generate:v2-oc2`).

So a **custom theme** without `v2Overrides` still gets every semantic token through the `mapping.ts` and `foreground.ts` fallbacks. This is why component code must use semantic tokens: primitive steps and hex values have different meanings in each theme.

## Rules

1. Use semantic tokens that already switch between schemes. Write no scheme-specific CSS unless a token cannot express the difference.
   **Why:** Tokens follow all 36 themes; scheme selectors only cover light versus dark.
2. When a scheme difference is unavoidable, override a component-scoped custom property under `[data-color-scheme="dark"]`, not the full rule set. Write the selector as `[data-color-scheme="dark"] [data-component="..."]` or, inside a nested rule, `[data-color-scheme="dark"] & { ... }`. In Tailwind, use the `[[data-color-scheme=dark]_&]:` variant.
   **Why:** `ThemeProvider` sets this attribute to the resolved scheme for every theme.
3. Never use `.dark`, `.light`, `[data-theme="dark"]`, `[data-theme="light"]`, `@media (prefers-color-scheme: ...)`, or the Tailwind `dark:` variant in component or product code.
   **Why:** `data-theme` holds the theme ID (`oc-2`, `dracula`), not the scheme; `prefers-color-scheme` and `dark:` ignore the user's explicit choice.
4. Never branch on a theme ID in CSS or code (`[data-theme="dracula"]`, `themeId() === "nord"`).
   **Why:** Themes can be added or registered at runtime; ID checks break silently.
5. Read `useTheme().mode()` in TypeScript only for non-CSS assets that need a scheme (for example choosing a light or dark image). Do not use it to pick colors.
   **Why:** Colors belong in CSS tokens so they update without re-rendering.
6. Test every visual change in light, dark, and at least one non-default theme with a different hue and neutral (for example `dracula`, `solarized`, or `gruvbox`).
   **Why:** OC-2 is near-greyscale; hard-coded values often look right only there.
7. Do not edit generated theme data by hand. Change `theme.css` and run `bun run generate:v2-oc2` for OC-2; change `mapping.ts` or `foreground.ts` for the custom-theme fallback.
   **Why:** The OC-2 JSON `v2Overrides` is a generated copy of `theme.css`.

## Do / Don't

```css
/* Do: simplified from actions/submit.css. Scope a private variable, override only it in dark. */
:is([data-component="button-v2"][data-variant="submit"], [data-component="icon-button-v2"][data-variant="submit"]) {
  --submit-highlight: var(--v2-alpha-light-20);
}
[data-color-scheme="dark"] :is([data-component="button-v2"][data-variant="submit"], [data-component="icon-button-v2"][data-variant="submit"]) {
  --submit-highlight: var(--v2-alpha-light-60);
  color: var(--v2-text-text-inverse);
}

/* Don't: components/scroll-view.css (legacy, wrong selectors) */
.dark .scroll-view__thumb::after,
[data-theme="dark"] .scroll-view__thumb::after {
  background: rgba(255, 255, 255, 0.4);
}
```

```tsx
// Do: typography/wordmark/wordmark.tsx
<g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">

// Don't
<g class="dark:opacity-100">
```

```css
/* Do: one token, no scheme selector */
[data-slot="panel"] {
  background: var(--v2-background-bg-layer-01);
}

/* Don't */
[data-slot="panel"] { background: #fafafa; }
@media (prefers-color-scheme: dark) {
  [data-slot="panel"] { background: #242424; }
}
```

## Test themes

- **Storybook** (`bun run --cwd packages/storybook storybook`): the toolbar toggles light and dark (`theme` global). It has no theme picker. For a non-default theme, run `localStorage.setItem("opencode-theme-id", "dracula")` in the preview frame's console and reload, or call `useTheme().setTheme("dracula")` from a story. Remove the key to return to OC-2.
- **App:** Settings → Appearance sets the scheme and theme.
- **Unit tests:** `resolveThemeVariantV2(variant, isDark)` returns the full token map; see `src/theme/v2/resolve.test.ts` for fallback and contrast assertions.

## Checklist

- [ ] My CSS has no scheme selector, or only `[data-color-scheme="dark"]`, and it overrides a custom property where possible.
- [ ] No `.dark`, `[data-theme=...]`, `prefers-color-scheme`, or Tailwind `dark:`.
- [ ] No theme-ID checks in CSS or TypeScript.
- [ ] I checked light, dark, and one non-default theme.
- [ ] Theme data changes went through `theme.css` + `generate:v2-oc2` or `mapping.ts`/`foreground.ts`, with a test in `resolve.test.ts`.

## Enforced by

- `design/dark-mode-selector`: flags color-scheme selectors other than `[data-color-scheme=...]`, such as `.dark` and `[data-theme="dark"]`. Run `bun run --cwd packages/ui lint:design <files>`. Suppress a justified case on the line: `/* design-lint-allow design/dark-mode-selector: <reason> */`.
- Rules 4–7 are review only.
