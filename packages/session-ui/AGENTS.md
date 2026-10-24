## Localization

Follow the Localization section of `packages/app/AGENTS.md`. It owns the shared rules for English source copy and translation review. In this package:

- Render count-sensitive copy through `i18n.plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `i18n.t(...)`; `pluralForm(...)` is reserved for components that animate individual grammatical forms.

## Typography

Follow the Typography section of `packages/ui/AGENTS.md`. Transcript, tool, notice, and truncation text at `13px` uses `--line-height-compact` (`16px`).
