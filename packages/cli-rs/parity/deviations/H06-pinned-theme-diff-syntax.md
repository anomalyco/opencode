# H06: diff syntax colors in a theme other than `opencode`

TypeScript: when the TUI starts with a theme other than `opencode` (for example `tokyonight`, `opencode2`, or
`cursor` set in `cli.json`), the edit tool's diff in `E.7a/tools` shows its code in the plain diff text color
(`diff.text.context`), with no syntax colors. With the default `opencode` theme the same diff is highlighted.
The recording is stable across reruns, so it is not a settling race in the harness.

Rust: the diff is highlighted in every theme, with the syntax style generated from the active theme.

Reason: Rust shows the behavior TypeScript has in its default theme; the missing highlight looks like a
TypeScript defect in how the diff keeps its syntax style when the theme differs from the store default
(`context/theme.tsx`, `createSyntaxStyleMemo`). Not investigated further in TypeScript. The
`rs-theme-colors/*-tools` checkpoints name this file; every cell that differs there is a syntax color or the
italic attribute of a highlighted token.
