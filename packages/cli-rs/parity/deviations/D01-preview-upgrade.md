# D01: `upgrade` in a preview build

TypeScript: `opencode upgrade` (alias `update`) updates the TypeScript CLI.

Rust: `opencode-rs upgrade` delegates to `opencode upgrade` (D.1), which updates the TypeScript CLI, not
`opencode-rs`. In a preview build (version `0.0.0-rs-<run>`, `crates/cli/src/commands/upgrade.rs`) it does
not delegate; it prints this to stderr and exits 1:

```
This is an opencode-rs preview build; re-run the install script to update it.
`opencode upgrade` updates the TypeScript CLI.
```

Any other version (`local`, release versions) delegates as before.

Reason: preview builds come from the preview repository's install script, which the TypeScript updater does
not know about (`shipping/share-builds.md` section 5, step 2). The D.2 update flow replaces this.
