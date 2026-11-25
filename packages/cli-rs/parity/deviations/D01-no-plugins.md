# D01: `--no-plugins`

TypeScript: `opencode` has no flag that turns plugins off for one run; its help and completions list none.

Rust: `opencode-native --no-plugins` starts the TUI with no external plugin, of any carrier: no Luau, TypeScript or
local plugin loads, no JS host starts, and a project's plugin is not asked about. `/plugins` lists each target as
skipped, "opencode-native started with --no-plugins, which loads no external plugin". The built-ins load as always.
The root's help lists the flag, and each shell's completions offer it; it has no `--no-no-plugins` negation, and the
wizard does not ask about it. `OPENCODE_PLUGIN_LUAU=0` and `OPENCODE_PLUGIN_JS=0` still turn off one carrier while
they are set.

The tests that hold the command table, the help and the usage errors to TypeScript's recordings leave the flag out
(`Flag::own`, `crates/cli/src/tests`), and the P-CLI completions cases mask its lines on both sides
(`parity/scenarios/C.0/own-flags.ts`).

Reason: opencode-native has no crash guard. A plugin that crashes or freezes the client as it starts would
stop every run; the flag is the way back in to disable or remove it.
