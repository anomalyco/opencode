# V01: the T.1 transcript is plain text

TypeScript: the session view has a header row with the title on `background.panel`, user messages in a box
with a left border (`┃`), assistant text as Markdown indented by three columns, and a footer per assistant
reply ("Build · provider/model · 2ms", V12). A streamed text delta that starts with a space shows on a new
line in this fixture (`H.2/session-open`, checkpoint `streamed`).

Rust: T.1's stand-in transcript (`crates/tui/src/routes/session/messages/list.rs`) shows the title in bold on
the page background, then user and assistant text as plain lines without borders, indentation, Markdown, or
footers. A delta is appended to its line. P-APP `H.2/home-sessions` (`session`) and `H.2/session-open`
(`open`, `streamed`) differ in the header and transcript rows.

Reason: not built yet. E.6a replaces the transcript (V01 to V04, V12), then removes this file and the
`deviation` entries that name it.
