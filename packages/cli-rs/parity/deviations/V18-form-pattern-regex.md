# V18: form field patterns use Rust regex syntax

**TypeScript.** A string field's `pattern` is checked with `new RegExp(field.pattern).test(value)`
(`packages/tui/src/util/form.ts:82-87`), an ECMAScript regex without flags. Lookahead, lookbehind and backreferences
work, and `\d`, `\w` and `\b` match ASCII only.

**Rust.** `crates/ui/src/form.rs` checks the pattern with `regex::Regex`. Here is what differs:

- **Lookahead, lookbehind and backreferences do not compile.** The field then shows `Invalid pattern: <pattern>` for
  every answer, where TS checks the answer. Example: `^(?!main$)[a-z]+$` accepts `dev` in TS; Rust rejects every
  answer with `Invalid pattern: ^(?!main$)[a-z]+$`.
- **`\d`, `\w` and `\b` match Unicode.** `^\d+$` accepts `١٢٣` (Arabic-Indic digits) and `^\w+$` accepts `café` in
  Rust; TS rejects both with `Must match pattern: …`.

Patterns that use neither give the same result in both clients.

**Reason.** The user kept the `regex` crate instead of adding an ECMAScript engine such as `regress` (O-58, O-88).
`regex` runs in linear time, so a pattern from a server or tool cannot hang the UI.
