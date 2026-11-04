# V01: a delta on a finished reply

E.6a's transcript rows (user messages, Markdown text, reasoning, the footer, and token usage) equal the
TypeScript cells. Since E.12 drew the tab strip and took T.1's session header and column gaps out, the session
layout equals TS too, and since E.14 drew the prompt footer hints, so does the prompt. One difference remains.

A delta on a finished reply. In `H.2/session-open` (`streamed`), a `session.text.delta` of `" Fixed."` arrives
for a reply that has already completed. TypeScript shows `Fixed.` on a new line under
`The parser drops the last token.` Rust shows `The parser drops the last token. Fixed.` on one line, as Markdown
renders that text when it is parsed whole. Reason: the stored text is one paragraph
(`The parser drops the last token. Fixed.`), so the TypeScript break is not in the content; it shows only when a
widget that is no longer streaming gets more text. A reply that streams normally gets its deltas before it
completes. Rust does not copy the break (Q11). Not investigated further in Core.

The other scenarios that still name this file now equal TS; a step that re-records them can drop the name.
