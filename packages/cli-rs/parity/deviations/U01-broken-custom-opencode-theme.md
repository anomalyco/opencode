# U01: a broken custom `opencode` theme falls back to the built-in one

**TypeScript.** A custom theme file named `opencode` replaces the built-in `opencode` theme
(`packages/tui/src/theme/index.ts:42-52`), and `opencode` is the theme every failed theme falls back to. When the
custom `opencode` is malformed, that fallback fails too: the `selected` memo rethrows for `opencode`
(`packages/tui/src/context/theme.tsx:298-308`), so the TUI stops. For example, `setCustomThemes({ opencode: { base:
{} } })` makes `parseTheme(allThemes().opencode)` throw `Invalid theme: opencode value is an invalid value`.

**Rust.** `ThemeState` (`crates/ui/src/theme/state.rs`) shows the failed theme's error toast as for any broken
theme, then loads the built-in `opencode` theme and logs `custom theme opencode: <message>; using the built-in
opencode theme`. This holds whether the broken custom `opencode` was selected or was the fallback of another theme
(a broken custom theme, or `system` without a terminal palette).

**Reason.** The user's decision O-89: fix the defects the TypeScript client shares in Rust, and record them as
deviations. A broken theme file should not stop the client.
