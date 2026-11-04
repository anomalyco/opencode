# P01: the prompt footer has no hints yet

TypeScript: the prompt footer row ends with the `prompt.footer` plugin's hints, "shift+tab agents" and
"ctrl+p commands" (`feature-plugins/prompt/footer.tsx`).

Rust: E.2 draws the prompt itself cell for cell: the `┃` border, the textarea, the metadata row, the `╹▀▀…`
edge, and the footer's `directory:branch`. The hints are missing. P-APP `E.2/prompt-typing` (`open`,
`typed`), `H.2/home-sessions` (`session`), and `H.2/session-open` (`open`, `streamed`) differ in those
cells of the footer row.

Reason: the hints come from the prompt footer plugin, which E.14 builds (`plugins/prompt_footer.rs`). E.14
removes this file and the `deviation` entries that name it. The file keeps its H.2 name, so the H.2
recordings stay valid.
