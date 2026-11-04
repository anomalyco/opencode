# P01: the prompt footer has no hints yet

TypeScript: the prompt footer row ends with the `prompt.footer` plugin's hints, "shift+tab agents" and
"ctrl+p commands" (`feature-plugins/prompt/footer.tsx`).

Rust: E.2 draws the prompt itself cell for cell: the `┃` border, the textarea, the metadata row, the `╹▀▀…`
edge, and the footer's `directory:branch`. The hints are missing. P-APP `E.2/prompt-typing` (`open`,
`typed`), `H.2/home-sessions` (`session`), and `H.2/session-open` (`open`, `streamed`) differ in those
cells of the footer row. TS also shortens the `directory:branch` label (`truncateFilePath`) to the width the hints
leave, so a session pane narrowed by a right pane shows `/…/tui:main`; `E.13a/terminal` masks that row.

The editor context's file label (E.5, `prompt.footer.file`) sits before the hints in TS. Without them it
ends at the right edge of the row, so in `E.5/ide` (`selected`, `mentioned`) and `E.5/zed` (`selected`) the
label's cells are shifted; its text and colors match.

Reason: the hints come from the prompt footer plugin, which E.14 builds (`plugins/prompt_footer.rs`). E.14
removes this file and the `deviation` entries that name it. The file keeps its H.2 name, so the H.2
recordings stay valid.
