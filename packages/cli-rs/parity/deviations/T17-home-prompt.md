# T17: the home's prompt is the T.1 stand-in

TypeScript: the home (`packages/tui/src/routes/home.tsx`) centers the logo above the prompt: a bordered input
(`┃` rows and a `╹▀▀…` bottom edge, five rows) and the prompt footer with the directory, branch, and hints.

Rust: E.1 builds the same home: the logo, the prompt slot (75 columns at most, one row of padding above), and
the home footer with the version in the bottom right corner. The prompt in that slot is still T.1's one-line
stand-in ("Read only: the prompt is not built yet"), so the column is four rows shorter and the logo sits two
rows lower. P-APP `H.2/home-sessions` (`home`, `list`) differs in rows 9 to 20 only; the footer row matches.

Reason: not built yet. E.2's prompt goes into the home through `prompt::editor::mount(tui, None)`; once it is
in, remove this file and the `deviation` entries that name it.
