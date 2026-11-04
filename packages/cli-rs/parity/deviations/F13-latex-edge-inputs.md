# F13: LaTeX edge inputs that TypeScript handles by accident

`crates/latex` ports `packages/latex/src` (`docs/P.2.md`). The P-ORACLE (`parity/fixtures/P.2/layouts.json`, 207
sources) and the P-COMP fixtures are equal. These inputs are outside that corpus and differ:

- **Characters outside the Basic Multilingual Plane typed literally**, such as `𝔤` or an emoji. TS reads the
  source by UTF-16 unit, so the glyph becomes two lone surrogates, two cells wide. Rust reads by `char` and draws
  one glyph.
- **Commands named like JavaScript object properties**, such as `\toString` or `\constructor`. TS looks up
  `command in accents` and finds the prototype property, so the command draws as an accent. Rust rejects them as
  unsupported commands, and the source shows.
- **User macros and the `maxSourceLength`, `maxExpand`, and `maxDepth` options** of `parseLatex` are not ported.
  The plugin never passes them. The default limits (100 000 characters, 256 levels) are kept, counted in `char`
  instead of UTF-16 units.
- **The mouse wheel over a formula.** TS stops Shift-wheel and horizontal wheel events at the formula, even when it
  cannot scroll further. opentui-rust's `ScrollBox` passes a wheel step it cannot use to the transcript.
  Unshifted vertical wheel steps reach the transcript in both.

**Reason.** These follow from the TS runtime (UTF-16 strings, object lookups) or from widget behavior, not from
the formula rules. Rust keeps the intended behavior.
