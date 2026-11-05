# P15: the gap cells of the prompt metadata line keep another foreground

TypeScript: the metadata line (`packages/tui/src/component/prompt/metadata.tsx`) is a row of `<text>` elements with
one-cell gaps: agent, `·`, model, provider. No text draws the gap cells, so they keep the foreground of the prompt's
background fill, `#ffffffff`.

Rust: the same cells hold a space with the muted foreground, `#808080ff`. Glyph and background are the same, so the
two lines look the same on screen. P-TUI `H.5/permission-reply` (`home` row 18 and `replied` row 26, three cells each)
and H.4's `drive` captures show it.

Reason: an opentui-rust difference not yet aligned (plan 7.4, G.8): which foreground a cell that no widget draws
keeps. No visible effect, so the step that aligns blank-cell styles in opentui-rust removes this file.
