# F16: a plugin's field and prompt as contract 2.0 has them

**TypeScript.** A TUI plugin gives its own `<input>` the focus from code (`ref.focus()`), so what the user types goes
into the field. `api.ui.DialogPrompt` takes a `value` that fills the field and a `description` drawn above it.
`@0xuwui/opencode-session-manager` uses both: `/` focuses its search field, and `r` asks for a new title with the
session's directory above a field filled with its title.

**Rust.** The host gives a field the focus (`Host::focus`, feature `focus-input` of contract 2.x) once the call that
asks returns, and before the mount's next view. Session-manager's `/` shows the field and focuses it in one call, so
the field is not yet in the host's tree and the focus is refused: the keys typed right after `/` go elsewhere and the
search finds nothing. The native port asks again at its next wake, which a user's next key comes after, but keys typed
in one burst with `/`, as the scenario types them, do not; a Luau plugin has no wake to ask again; and the JS host
passes no focus of a field. A prompt (`Dialog::Prompt`) has a title and a placeholder: no value and no description, so
the rename prompt is empty under its title. The published package on the JS host and its native and Luau ports
(`crates/plugin/examples/session-manager`, `crates/plugin/examples/luau/session-manager`) draw the same: the search row
without the typed text, and the empty prompt.

**Reason.** A focus that waits for the mount's next view, and a prompt's value and description, are in the list of
what the contract lacks (`steps/ports-trio.md`); neither is in this step's contract. `parity/scenarios/P.8/
session-manager.app.ts` drives both: its `search` and `rename` checkpoints differ by these cells on every carrier,
and the rest of the scenario is equal.
