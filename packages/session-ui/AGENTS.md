## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, empty states, and displayed errors.
- Feature work adds English source strings only; leave non-English keys absent. Preserve existing English text and keys byte-for-byte unless the task explicitly requests a copy change, and never change English to make translation easier.
- Render count-sensitive copy through `i18n.plural(baseKey, count, params)`. Never pass plural-category keys (`.one`, `.other`, …) to `i18n.t(...)`. Use `i18n.tDynamic(...)` for runtime-generated English copy; never branch on the active locale.
- Use logical CSS properties and isolate mixed-direction text; layouts must work in RTL.
- Do not translate from model knowledge alone; follow the translation process in the skill.
- Load the `opencode-ui-i18n-rtl` skill (`packages/ui/skills/opencode-ui-i18n-rtl/SKILL.md`) for the full rules, API examples, RTL guidance, and the translation process.

## Typography

- Give `13px` Inter text at least `--line-height-compact` (`16px`); use `--line-height-base` (`20px`) for body text. A solid `13px` line box clips descenders inside truncation and overflow containers.
- Do not use `line-height: 1` or `leading-none` on text, and do not compensate with transforms, negative margins, or clip-padding hacks.
- `TextShimmer` inherits font metrics; put typography overrides on its parent.
- Load the `opencode-ui-typography` skill (`packages/ui/skills/opencode-ui-typography/SKILL.md`) for the type scale, weights, tracking, numeric figures, and truncation rules.
