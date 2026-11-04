# V01: the session layout above the transcript, and a delta on a finished reply

E.6a's transcript rows (user messages, Markdown text, reasoning, the footer, and token usage) equal the
TypeScript cells. With the two-row offset below removed, `E.6a/transcript` (`open`) and `H.2/session-open`
(`open`) match cell for cell: symbols, colors, and attributes. Two differences remain.

1. Layout. TypeScript draws the tab bar with the title on row 0 and the transcript right under it. Rust's
   session route (`crates/tui/src/routes/session/mod.rs`, T.1) has one row of top padding, the title, and a gap
   of one row before the transcript, so every transcript row sits two rows lower. The prompt and footer rows
   below differ for P01 and T04. Reason: not built yet. The step that builds the session tab bar or the session
   header (W, E.1) takes the padding and the gap out and removes this part.
2. A delta on a finished reply. In `H.2/session-open` (`streamed`), a `session.text.delta` of `" Fixed."`
   arrives for a reply that has already completed. TypeScript shows `Fixed.` on a new line under
   `The parser drops the last token.` Rust shows `The parser drops the last token. Fixed.` on one line, as
   Markdown renders that text when it is parsed whole. Reason: the stored text is one paragraph
   (`The parser drops the last token. Fixed.`), so the TypeScript break is not in the content; it shows only
   when a widget that is no longer streaming gets more text. A reply that streams normally gets its deltas
   before it completes. Rust does not copy the break (Q11). Not investigated further in Core.
