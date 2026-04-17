# Effect loose ends

Small follow-ups that do not fit neatly into the main facade, route, tool, or schema migration checklists.

## Config / TUI

- [ ] `config/tui.ts` - finish the internal Effect migration after the `Instance.state(...)` removal.
      Keep the current precedence and migration semantics intact while converting the remaining internal async helpers (`loadState`, `mergeFile`, `loadFile`, `load`) to `Effect.gen(...)` / `Effect.fn(...)`.
- [ ] `config/tui.ts` callers - once the internal service is stable, migrate plain async callers to use `TuiConfig.Service` directly where that actually simplifies the code.
      Likely first callers: `cli/cmd/tui/attach.ts`, `cli/cmd/tui/thread.ts`, `cli/cmd/tui/plugin/runtime.ts`.
- [ ] `env/index.ts` - move the last production `Instance.state(...)` usage onto `InstanceState` (or its replacement) so `Instance.state` can be deleted.

## ConfigPaths

- [ ] `config/paths.ts` - split pure helpers from effectful helpers.
      Keep `fileInDirectory(...)` as a plain function.
- [ ] `config/paths.ts` - add a `ConfigPaths.Service` for the effectful operations so callers do not inherit `AppFileSystem.Service` directly.
      Initial service surface should cover:
  - `projectFiles(...)`
  - `directories(...)`
  - `readFile(...)`
  - `parseText(...)`
- [ ] `config/config.ts` - switch internal config loading from `Effect.promise(() => ConfigPaths.*(...))` to `yield* paths.*(...)` once the service exists.
- [ ] `config/tui.ts` - switch TUI config loading from async `ConfigPaths.*` wrappers to the `ConfigPaths.Service` once that service exists.
- [ ] `config/tui-migrate.ts` - decide whether to leave this as a plain async module using wrapper functions or effectify it fully after `ConfigPaths.Service` lands.

## Instance cleanup

- [ ] `project/instance.ts` - remove `Instance.state(...)` once `env/index.ts` is migrated.
- [ ] `project/state.ts` - delete the bespoke per-instance state helper after the last production caller is gone.
- [ ] `test/project/state.test.ts` - replace or delete the old `Instance.state(...)` tests after the removal.

## Notes

- Prefer small, semantics-preserving config migrations. Config precedence, legacy key migration, and plugin origin tracking are easy to break accidentally.
- When changing config loading internals, rerun the config and TUI suites first before broad package sweeps.
