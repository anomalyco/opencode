---
name: OpenCode UI Typography
description: Use when you set font family, size, weight, line height, letter spacing, numeric figures, or truncation on text built with or styled to match @opencode/ui, or when you copy text styles from a Figma export.
---

# OpenCode UI Typography

> Design rules in this skill come from the design system owner. Fix facts (paths, prop names, token names) directly. To change a rule, record design feedback with `/design-feedback`.

The current (v2) UI uses Inter at **13px** for almost all interface text, with two variable-font weights (**440** regular, **530** emphasis) and three fixed line-height tokens. The full role table and the inventory of real usages are in [references/type-scale.md](references/type-scale.md).

## Where the type tokens live

| Token                                         | Value                                  | Defined in                    |
| --------------------------------------------- | -------------------------------------- | ----------------------------- |
| `--font-family-sans`                          | `"Inter", ui-sans-serif, system-ui, …` | `src/styles/theme.css`        |
| `--font-family-mono`                          | `"IBM Plex Mono", ui-monospace, …`     | `src/styles/theme.css`        |
| `--v2-font-family-sans`, `--font-family-text` | `var(--font-family-sans)`              | `src/styles/tokens/theme.css` |
| `--v2-font-family-code`                       | `var(--font-family-mono)`              | `src/styles/tokens/theme.css` |
| `--line-height-tight`                         | `12px`                                 | `src/styles/tokens/theme.css` |
| `--line-height-compact`                       | `16px`                                 | `src/styles/tokens/theme.css` |
| `--line-height-base`                          | `20px`                                 | `src/styles/tokens/theme.css` |

Import the tokens with `@import "@opencode/ui/styles/tokens";` (as `packages/app/src/index.css` does). Tailwind (`src/styles/tailwind/index.css`) exposes the line heights as `leading-text-tight`, `leading-text-compact`, and `leading-text-base`, and the families as `font-sans` and `font-mono`.

The older scales in `src/styles/theme.css` (`--font-size-small` … `--font-size-x-large`, `--font-weight-regular: 400`, `--font-weight-medium: 500`, `--line-height-large: 150%`, and the `.text-12-*`/`.text-14-*` classes in `src/styles/utilities.css`) belong to the legacy `data-appearance="standard"` styles. Do not use them for new v2 UI.

## Rules

1. Use `--v2-font-family-sans` (Inter) for interface text and `--v2-font-family-code` for code, paths in code blocks, and shell output. Do not write `font-family: Inter, sans-serif`.
   **Why:** The token carries the full fallback stack and lets a theme change the family in one place.
2. Use 13px for body, control, row, menu, input, and label text. Use 11px only for captions, metadata, badges, keybinds, tooltips, and group labels.
   **Why:** The v2 components share one 13px text size; other sizes break vertical rhythm between controls.
3. Use weight 440 for regular text and 530 for emphasis (buttons, field labels, titles, captions in caps). Do not use 400, 500, `font-medium`, or `font-bold` in v2 UI.
   **Why:** Inter is a variable font and the design is tuned to 440/530; Tailwind `font-medium` resolves to the legacy 500.
4. Give 13px text a line height of `--line-height-compact` (16px) for single-line controls and rows, and `--line-height-base` (20px) for multi-line body, descriptions, and buttons. Never give 13px Inter less than 16px.
   **Why:** A solid 13px line box clips the descenders of `g`, `j`, `p`, `q`, and `y` when the text or an ancestor truncates or hides overflow.
5. Do not use `line-height: 1`, `100%`, `1em`, or `leading-none` on text. Reserve them for icons, non-text glyphs, and display marks that a designer reviewed.
   **Why:** Figma exports solid line heights; they clip in overflow and truncation containers.
6. Do not fix line metrics with `transform`, negative margins, or clip-padding. Set the correct line height and keep control and row heights explicit (`height: 28px`, `h-7`).
   **Why:** Paint-space hacks move hit zones and focus rings away from the visible text.
7. Pair each size with its tracking: 13px → `letter-spacing: -0.04px`; 11px → `0.05px`; 15px → `-0.13px`; 20px → `-0.3px`.
   **Why:** Inter optical spacing differs per size; the designer set these values in every v2 component.
8. Add `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`) to text that shows changing or aligned numbers: counters, timers, sizes, keybinds, and numeric inputs (`data-numeric` on `TextInput` and `Select`).
   **Why:** Proportional figures make values jitter as they change.
9. Truncate single-line text with `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` (Tailwind `min-w-0 truncate`) on the text element, and keep the compact or base line height on it. Put the full value in a `title` or `Tooltip` when the text can be cut.
   **Why:** Flex children do not shrink without `min-width: 0`, and the overflow container is where descenders clip.
10. Put typography overrides for `TextShimmer` on its parent element.
    **Why:** `TextShimmer` sets `font: inherit; letter-spacing: inherit; line-height: inherit` on every slot, so it inherits all metrics.
11. Use logical alignment (`text-align: start`, `text-start`) and isolate user or path text with `dir="auto"` or `<bdi>`. See the `opencode-ui-i18n-rtl` skill.
    **Why:** Physical alignment breaks in RTL layouts.

## Do / Don't

```css
/* Do: compact 13px row text (navigation/menu/menu.css) */
[data-slot="menu-v2-item-content"] {
  font-size: 13px;
  font-weight: 440;
  line-height: var(--line-height-compact);
  letter-spacing: -0.04px;
}

/* Don't: solid line box from a Figma export */
[data-slot="row-title"] {
  font-size: 13px;
  line-height: 13px;
  overflow: hidden;
}
```

```tsx
// Do (adapted from packages/app/src/session/composer/queue-panel.tsx)
<span class="min-w-0 truncate text-[13px] font-[440] leading-[var(--line-height-compact)]">{title}</span>

// Don't
<span class="truncate text-[13px] font-medium leading-none -translate-y-px">{title}</span>
```

```css
/* Do: fix the metric (session-ui/src/components/tool-error-card.css) */
/* Figma's leading-none would clip Inter descenders at 13px; keep the compact metric. */
[data-slot="basic-tool-tool-title"] {
  font-family: var(--v2-font-family-sans);
  line-height: var(--line-height-compact);
}

/* Don't: compensate with paint-space hacks */
[data-slot="basic-tool-tool-title"] {
  line-height: 1;
  margin-block-start: -2px;
  padding-block-end: 2px;
}
```

```tsx
// Do: style the parent of TextShimmer
<span class="text-[13px] font-[530] leading-[var(--line-height-compact)]">
  <TextShimmer text={label()} />
</span>

// Don't: override the inner slots, which reset font, letter-spacing, and line-height to inherit
<TextShimmer text={label()} class="[&_[data-slot=text-shimmer-char]]:font-[530]" />
```

## Checklist

- [ ] Family is `--v2-font-family-sans` or `--v2-font-family-code`, not a literal font name.
- [ ] Size is 13px (or 11px for captions/meta, 15px for dialog titles, 20px for display).
- [ ] Weight is 440 or 530.
- [ ] 13px text has a line height of at least `--line-height-compact` (16px).
- [ ] No `line-height: 1`, `100%`, `1em`, or `leading-none` on text.
- [ ] No transforms, negative margins, or clip-padding used to align text.
- [ ] Tracking matches the size.
- [ ] Changing or aligned numbers use `tabular-nums`.
- [ ] Truncated text has `min-w-0`, keeps its line height, and exposes the full value.
- [ ] `TextShimmer` overrides are on the parent.

## Enforced by

- `design/no-solid-line-height`: flags `line-height: 1`, `1.0`, `100%`, and `1em`, the `font: <size>/1` shorthand, and Tailwind `leading-none` and `leading-[1]`. Run `bun run --cwd packages/ui lint:design <files>`. When a solid line height is intentional (an icon glyph or a reviewed display mark), suppress it on that declaration with a reason: `/* design-lint-allow design/no-solid-line-height: uppercase 11px keycap, no descenders */`. An allow comment without a reason does not suppress.
- The lint does not catch a pixel line height that equals the font size (for example `font-size: 13px; line-height: 13px`), transform or negative-margin hacks, or rules 1–3 and 6–11. Check these in review.
