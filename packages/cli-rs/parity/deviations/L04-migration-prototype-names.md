# L04: keybind names that are JavaScript object properties

**TypeScript.** The in-place migration (`packages/cli/src/config/migrate.ts:66-92`) looks keybind names up with
`CommandMap[name]` and `name in Definitions`. Names such as `constructor` or `toString` find inherited
`Object.prototype` members, so a `keybinds.constructor` entry is removed and `keybinds.toString` is kept as a
current name.

**Rust.** `migrate::rewrite` looks names up in the generated tables only, so both are unknown names and stay as
they are. The decoder drops them either way, so the loaded config is the same.

**Reason.** The TS behavior comes from JavaScript property lookup, not from a rule.
