## Localization

Follow the Localization section of `packages/app/AGENTS.md`. It owns the shared rules for English source copy and translation review. In this package:

- Component defaults are user-visible copy, so they need i18n keys too.
- Render count-sensitive copy through `plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `t(...)`; `pluralForm(...)` is reserved for components that animate individual grammatical forms.
- Use `tDynamic(...)` when runtime-generated English source copy has keyed non-English alternatives. Do not branch on the active locale in feature code.

## Typography

- Use the shared typography metrics instead of copying solid line heights from design exports: `--line-height-tight` is `12px`, `--line-height-compact` is `16px`, and `--line-height-base` is `20px`.
- Inter text at `13px` must use at least the compact `16px` line height. A `13px` solid line box can clip `g`, `j`, `p`, `q`, and `y` when the text or an ancestor truncates or hides overflow.
- Reserve `line-height: 1` and `leading-none` for non-text glyphs, icons, or deliberately reviewed display marks. Do not compensate text with transforms, negative margins, or clip-padding hacks.
- `TextShimmer` inherits font metrics. Put typography overrides on its parent when they must supersede the component defaults.
