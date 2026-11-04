# P01: no prompt in the session view yet

TypeScript: the session view ends with the prompt: a bordered input (`┃` rows and a `╹▀▀…` bottom edge) and the
prompt footer with the directory and branch (`/tmp/opencode/packages/tui:main`) and the hints
"shift+tab agents" and "ctrl+p commands".

Rust: T.1 shows one muted line, "Read only: the prompt is not built yet", where the prompt goes. P-APP
`H.2/home-sessions` (`session`) and `H.2/session-open` (`open`, `streamed`) differ in the bottom rows.

Reason: not built yet. E.2 builds the prompt (P01 to P03, P07, P12 to P15), then removes this file and the
`deviation` entries that name it.
