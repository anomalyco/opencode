# D01: `upgrade` in a preview build

TypeScript: `opencode upgrade` (alias `update`) updates the TypeScript CLI.

Rust: `opencode-native upgrade` delegates to the TypeScript binary's `upgrade` (D.1): `OPENCODE_TS_BIN`, else the
`opencode` bundled beside `opencode-native`, else `opencode` on `PATH`. That updates that TypeScript CLI, and
`opencode-native` only when it is the bundled one of an install whose updater replaces both. In a preview build (version `0.0.0-native-<run>`, `crates/cli/src/commands/upgrade.rs`),
which bundles its server, it does not delegate; it prints this to stderr and exits 1:

```
This is an OpenCode native CLI preview build; re-run the install script to update it and its bundled server.
`opencode upgrade` updates a separate TypeScript install, not this one.
```

Any other version (`local`, release versions) delegates as before.

After the install script replaced both binaries, the background service still runs the old version. The next
`opencode-native` (TUI) or `opencode-native mini` restarts it on the new bundled binary, as TS's client does after
`opencode upgrade` (O-167, `S03-never-replace`).

Reason: preview builds come from the preview repository's install script, which the TypeScript updater does
not know about (`shipping/share-builds.md` section 5, step 2), and the install script replaces both binaries
(bundle-server). The D.2 update flow replaces this.
