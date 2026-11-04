# DLG19: skill mentions in the prompt

## TypeScript

Picking a skill inserts `@<id> ` at the cursor, adds `{ id, mention }` to `prompt.skills`, and ties the part to
a virtual extmark with the skill style (`packages/tui/src/component/prompt/index.tsx:588-616`). The extmark
moves with edits and goes when the text is deleted; submit sends the parts that still have one
(`syncExtmarksWithPromptParts`, `:810-876`). A failed skill read shows `errorMessage(error)`.

## Rust

`dialogs::skill::mention` inserts the same text and records the same part in the prompt's `PromptInfo`. There
are no extmarks yet: at submit, `attachments` keeps the parts whose mention text still occurs in the prompt and
recomputes `start`/`end` (display cells, a newline counting one) from its first occurrence. The mention is not
styled. A failed read shows the Rust client error's text.

## Reason

Prompt extmarks and part styles belong to the autocomplete step (E.3, plan 8.4), which also needs them for
files and agents. Until then the request carries the same `skills` attachment for an unedited mention, which
`picking_a_skill_mentions_it_and_the_prompt_sends_it` checks.
