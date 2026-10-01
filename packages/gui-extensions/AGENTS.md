# GUI extensions

Built-in features of the desktop and web app, each behind the SDK in `src/sdk/`. The renderer host lives in `packages/app/src/runtime/extension/`, the main-process host in `packages/desktop/src/main/extension/`.

## Structure

- One folder per extension: `index.ts` (`Extension.define({ id, os?, i18n })`), `contract.ts`, `renderer.tsx`, optional `main.ts`, and `i18n/<locale>.ts`.
- `src/renderer.ts` and `src/main.ts` are the only files that list the built-ins. Main never imports renderer code.
- Another extension may import only your `contract.ts` (tokens and schemas, no runtime code). Every consumer must still work when the provider is disabled: `ctx.use(Service)` is an accessor that can return `undefined`.
- Never import `@opencode/app`, `@opencode/desktop`, or `@/` paths. Import CSS with `?inline` and contribute it through `ctx.add(Style, css)`. No module-level state: keep state inside `setup`. `bun run lint` enforces these rules.

## Host boundary

- Host code must not name an extension or know its internals: no extension ids, command ids, DOM selectors, or stored key formats. When the host needs something from extensions, add a generic, documented field to the SDK (for example `PanelTab.file`, `Command.featured`, `Command.section`).
- Accepted exceptions: the built-in lists, the keybind rename map in `packages/app/src/settings/keybinds/migration.ts`, the legacy `type: "browser"` comment decode in `packages/app/src/composer/schema.ts` (drafts and message metadata written before extension notes), and the crash page's use of the updater contract.

## Performance

- Keep `renderer.tsx` small and put heavy UI behind `lazy()`. Preload a chunk with `onIdle(() => void Chunk.preload())` from setup, so it compiles while the app idles (e.g. on Home) instead of when a session first opens. Never import it on the startup path.
- Return stable objects from `Panel.list` and reactive contributions, so the host never remounts a trigger or a panel.
- Never add work to timeline rows. The session header slot is the only timeline surface.

## Localization

- Each extension owns its copy in `i18n/en.ts` with short keys. `ctx.t` falls back to the app's keys only for shared vocabulary such as `common.*`; feature copy belongs to the extension.
- When moving copy, keep the English byte-for-byte and carry every locale's translation. The localization rules in `packages/app/AGENTS.md` apply.

## Tests

- Follow the Tests section of `packages/app/AGENTS.md`.
- Unit-test pure logic that carries a contract: path and security checks, storage migration, protocol parsing, archive validation.
- UI behavior is proven by the app e2e keeper suites. Do not add unit tests that repeat them.
- Test a main-process entry through its `Remote` contract with real inputs, not through Electron mocks.
