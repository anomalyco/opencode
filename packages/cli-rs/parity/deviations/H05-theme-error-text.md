# H05: theme error text for unusual broken themes

**TypeScript.** A broken V2 theme reports `Invalid theme: <name> <value> is an invalid value`, where `<value>` is
read from the Effect Schema message (`got …`), or `value` when the message names none. A V1 theme that lacks a
color the migration reads fails later with a JavaScript type error (`undefined is not an object …`).

**Rust.** The schema check in `crates/ui/src/theme/document.rs` reproduces the value word for the cases in
`parity/oracle/U.1-themes.ts` (15 broken themes: bad, numeric, and object colors, a syntax token that is not a hue
reference, missing keys, empty and unknown categorical hues, bad hue steps, missing semantic hues, circular and
missing references, keys the schema drops, no modes). Other malformed documents fail the same way (the theme falls
back to `opencode` with a toast) but the value word can differ, because Effect's message format for nested unions
is not reproduced. A V1 theme missing a color fails with `Color "<key>" is missing from the theme`.

**Reason.** The message text only explains a bad file; reproducing Effect's issue formatter for every shape would
port a schema library for a toast. The V1 message replaces a JavaScript runtime error with one that names the key.
