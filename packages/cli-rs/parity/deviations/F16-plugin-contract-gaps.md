# F16: a plugin's field and prompt as contract 2.0 has them

**TypeScript.** A TUI plugin gives its own `<input>` the focus from code (`ref.focus()`), so what the user types goes
into the field. `api.ui.DialogPrompt` takes a `value` that fills the field and a `description` drawn above it.
`@0xuwui/opencode-session-manager` uses both: `/` focuses its search field, and `r` asks for a new title with the
session's directory above a field filled with its title.

**Rust.** Contract 2.0, the contract the native, Luau and JS-host plugins have, refuses a focus that names a field
(`Host::focus` takes a focusable box); the field takes the focus only from the user's click, so the keys typed after
`/` go elsewhere and the search finds nothing. Its prompt (`Dialog::Prompt`) has a title and a placeholder: no value
and no description, so the rename prompt is empty under its title. The published package on the JS host and its
native and Luau ports (`crates/plugin/examples/session-manager`, `crates/plugin/examples/luau/session-manager`) draw
the same: the search row without the typed text, and the empty prompt.

**Reason.** The contract 2.x proposal adds the focus of a field (`focus-input`); a prompt's value and description are
in the list of what it lacks (`steps/ports-trio.md`). Neither is in this step's contract. `parity/scenarios/P.8/
session-manager.app.ts` drives both: its `search` and `rename` checkpoints differ by these cells on every carrier,
and the rest of the scenario is equal.
