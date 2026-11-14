# O89: the paste chip keeps dark text in dark mode under the system theme

**TypeScript.** `generateSyntax` (`packages/theme/src/tui/syntax.ts`) draws `extmark.paste`, the
`[Pasted ~N lines]` chip, in the page color on `text.feedback.warning.base`, so the text is dark in dark mode and
light in light mode (#62930). When the page is transparent, as it is under the `system` theme, it takes
`text.action.primary.focused` (the selected-row text) instead. On the system theme that is the terminal's
foreground. In dark mode the chip text is then light on yellow. Example, Ghostty with Tokyo Night (background
`#1a1b26`, foreground `#a9b1d6`, yellow `#e0af68`): `#a9b1d6` on `#e0af68`, a contrast of 1.06. In light mode, with
background `#e1e2e7` and foreground `#3760bf`: `#3760bf` on `#8c6c3e`, 1.21.

**Rust.** `opencode_ui::code::syntax_theme` keeps the intent of #62930 when the page is transparent:

- The system theme keeps the terminal's background (OSC 11) in the channels of its transparent page. The chip text
  is that color, made opaque. Tokyo Night dark: `#1a1b26` on `#e0af68` (contrast 8.55). Light: `#e1e2e7` on `#8c6c3e`
  (contrast 3.75).
- A transparent page without a known background (a custom theme with `"background": "none"`) takes the opaque neutral
  step with the best contrast against the chip. This is always the darkest or the lightest neutral step.
- An opaque page is unchanged: `tokyonight` dark is still `#1a1b26` on `#ff966c`.

A known pure-black terminal background (`#000000`) can't be told apart from no background, because both resolve to
`rgba(0, 0, 0, 0)`. It takes the neutral fallback, which is the near-black end of its neutral scale on any yellow.

**Reason.** The user decided to fix the defects the TS client shares in Rust and record them as deviations, with no
upstream proposal (O-89).
