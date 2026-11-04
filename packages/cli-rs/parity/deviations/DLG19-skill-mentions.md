# DLG19: skill read errors

## TypeScript

Picking a skill inserts `@<id> ` at the cursor, adds `{ id, mention }` to `prompt.skills`, and ties the part to
a virtual extmark with the skill style (`packages/tui/src/component/prompt/index.tsx:588-616`). A failed skill
read shows `errorMessage(error)`.

## Rust

The pick is the same since E.3: `prompt::autocomplete::parts::insert_skill` adds an atomic extmark in the
`extmark.skill` style and the part, and submit sends the parts whose marks remain. A failed read shows the Rust
client error's text.

## Reason

The Rust client's errors are not the TS `ClientError` objects that `errorMessage` formats.
