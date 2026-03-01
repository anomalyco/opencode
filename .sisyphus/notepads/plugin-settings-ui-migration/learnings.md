- `git checkout dev -- <path>` command only updates existing files in the target branch. It does not delete files that exist in the current branch but not in the target branch.
- To exactly match a directory with another branch, use `git checkout <branch> -- <path>` followed by identifying and removing extra files (e.g., using `git diff <branch> --name-status -- <path>` to find 'A'dded files and removing them).

- i18n locale files live in `packages/app/src/i18n/` and share a consistent insertion spot around `settings.models.*`.
- Some locale files (e.g. `packages/app/src/i18n/zh.ts`) include blank lines between `settings.models.*` and `settings.agents.*`; patches should account for those separators when doing exact-context edits.
- Used SolidJS `createStore` combined with `produce` to properly mutate nested `Set<string>` collections for tracking dirty state in dynamically rendered arrays.
- Implemented robust error catching and fallback logic via standard `fetch` when utilizing internal API RPC client methods.
- Integrated the `SettingsPlugins` component into the `DialogSettings` within `packages/app`, ensuring it follows the existing UI pattern for the Server settings section.
- Used the `mcp` icon for the Plugins tab as per the architectural decision to fallback from the missing `puzzle` icon.

- 2026-03-01: `packages/app` `bun run typecheck` OK (`tsgo -b`); `bun run build` OK (vite build; chunk-size warning only).
