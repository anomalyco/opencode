# H06: the chunks of a large added file are highlighted one by one

TypeScript: the diff viewer shows an added file of more than 3,000 lines in chunks of 128 lines and mounts only the
chunks near the view (`VirtualAddedPatch`, `packages/tui/src/component/patch-diff.tsx`). A chunk is not valid source
on its own, so TS highlights the whole file once with `highlightOnce` and gives each chunk its slice of the result.

Rust: `opencode_ui::diff::Chunked` (`crates/ui/src/diff.rs`) mounts the same chunks the same way, but each chunk's
`Diff` highlights its own 128 lines. opentui-rust's `Diff` and `Code` take no highlights from outside. Where a
construct spans a chunk boundary, such as a multi-line string or block comment, the lines after the boundary can
take other colors than in TS. JSON, the case TS's own test uses, has no multi-line constructs and colors the same.

Reason: the chunks are what keeps a large added file from mounting thousands of lines at once (r2 review,
bigboi-ui-6). Highlighting the whole file for each chunk would bring that cost back. Files of 3,000 lines or fewer,
and every other patch, highlight as before.
