# V26: `auth login --answer` for a field of an unfamiliar type reports an error where TS throws

**TypeScript.** The client does not decode the integration list against the schema, so a form field of a type
the CLI does not know (from a newer server) reaches `answerForm` like any other. A supplied answer is decoded as
JSON (`packages/cli/src/commands/handlers/auth/form.ts:51-60`) and checked by `formValidateValue`'s last branch,
the multiselect one (`packages/tui/src/util/form.ts:105-109`). It rejects a non-array with `Expected selections`
and sends an empty array. For a non-empty array it reads `field.options.some`, and the field has no `options`,
so the command ends with `TypeError: undefined is not an object (evaluating 'field.options.some')` and a stack
trace.

**Rust.** `answer_form` (`crates/cli/src/commands/auth.rs`) does the same up to that point. For a non-empty array
it fails with `<key>: Select only available options`, the result the TS branch is written to give for a field
whose options do not include the selection, unless the field has `custom: true`, which TS accepts too. Both exit
with status 1 and send nothing.

**Reason.** The TS result is a crash, not a behavior to copy. The P-CLI scenarios
`C.5/login-answer-future-type` (empty selection, sent) and `C.5/login-answer-future-type-text` (not a selection)
compare the cases where TS does not throw.
