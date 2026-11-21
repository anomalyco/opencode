# V26: `auth login` answers a field of an unfamiliar type with a selection, where TS cannot

**TypeScript.** The client does not decode the integration list against the schema
(`packages/client/src/promise/generated/client.ts:2827`), so a form field of a type the CLI does not know (from a
newer server) reaches `answerForm` like any other (`packages/cli/src/commands/handlers/auth/form.ts:28-47`). It is
skipped when its `when` does not hold, and takes its `default` when `hidden`. A `--answer` value is decoded as JSON
(`form.ts:51-60`). Otherwise `answerField` falls through to its text prompt (`form.ts:139-149`): the title (or key),
the description, the default as `String(default)`, and `Required` for an empty answer to a required field. An
empty answer to an optional field skips it. Any other answer comes back as `Number(value)`.

`formValidateValue` then checks the value with its last, multiselect branch (`packages/tui/src/util/form.ts:73-75,
105-109`): a missing or empty answer to a required field gives `Answer required`, and a non-array gives
`Expected selections`. So:

- **A prompted answer never passes.** It is a number, and the check wants an array.
- **A non-empty selection throws.** The check reads `field.options.some`, and the field has no `options`. Unless
  the field is `custom`, the command ends with `TypeError: undefined is not an object (evaluating
  'field.options.some')` and a stack trace.

**Rust.** `unknown_answer` (`crates/cli/src/commands/auth.rs`) does the same as TS (`when`, the hidden default,
`--answer`, the prompt's title, description and `Required`, and the checks above), with three differences:

- The prompt takes a JSON value, as `--answer` does, instead of returning a number, so a selection can be typed:
  `[]`, or `["a"]` for a custom field.
- The prompt's initial value is the default written as JSON (`["west"]`), so that it can be accepted as typed. TS
  writes `String(default)` (`west`).
- A non-empty selection on a field that is not custom fails with `<key>: Select only available options`, which is
  what the TS branch is written to report for a field whose options do not include the selection. Both clients exit
  with status 1 and send nothing.

**Reason.** In TS, a prompted answer can never pass and a non-empty selection crashes. Neither is behavior to copy.
Rust does what the TS code intends: answer the field with the one kind of value its check accepts. These P-CLI
scenarios compare the cases where TS does not throw: `C.5/login-answer-future-type`,
`C.5/login-answer-future-type-text`, `C.5/login-future-type-hidden`, `C.5/login-future-type-hidden-text` and
`C.5/login-future-type-no-tty`. These P-PTY scenarios compare the prompt: `C.5/login-future-type` and
`C.5/login-future-type-required`.
