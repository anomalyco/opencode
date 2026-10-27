# Plugin Package Guide

- The server SDK has two versions: Effect and Promise. `src/tui/` is the TUI SDK and `src/gui/` the GUI SDK.
- In the Effect version, every domain must extend the corresponding Effect API client interface from `@opencode/client/effect/api`.
- Do not redefine functions that already exist on the Effect API client interface.
- Plugin domains add only the additional functions that make sense in the plugin context.
- The GUI SDK never loads in the server or the TUI, so `runtime-modules.ts` skips `gui/` and the CLI bundle does not grow.
- `src/gui/` follows `packages/gui-plugins/AGENTS.md`: the built-ins there are its main users, and `bun run lint` from the repository root checks its TSDoc (`script/sdk-docs.ts`). Run `bun run generate` here after the app's icon catalog changes.
- `src/gui/host.ts` (`@opencode/plugin/gui/host`) is the app's and desktop's internal protocol, for workspace imports only: `tsconfig.build.json` leaves it out of `dist` and `script/pack.ts` exports it as `null`. Keep public SDK modules from importing it.
- `src/gui/builtin.ts` (`@opencode/plugin/gui/builtin`, the API only the app's built-in plugins use) and `src/gui/updater.ts` (`@opencode/plugin/gui/updater`, the app's own updater contract) are workspace-only the same way, and neither is a module a plugin bundle may require. `src/gui/internal.ts` holds the window host's internals the public helpers read; `gui/host` re-exports them. The `./gui/*` export is `null`, so only the listed `gui` subpaths resolve.
