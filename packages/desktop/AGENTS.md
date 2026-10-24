# Desktop package notes

## Tests

- Follow the Tests section of `packages/app/AGENTS.md`: every test protects a named contract with a credible regression, has one owner, and can fail.
- Packaging, installer, IPC validation, credential, and SQLite migration and storage tests are contracts. Write them as tables: one table across channels, not one test per channel.
- Never add test-only parameters or exports to production modules (`now`, `delay`, `budget`). Use `setSystemTime` from `bun:test`.
- Test IPC through the raw message format the renderer sends, not through a mock client.
- No source-grep or tombstone tests that assert a file, export or feature is gone.
- Main-process code that belongs to a GUI extension is tested in `packages/gui-extensions`, not here.
- `bun typecheck` does not cover test files. Run `bun test <file>` for every test file you touch.

## Code

- Follow Solid best practices, leave a comment when violating this: https://www.brenelz.com/posts/solid-js-best-practices/
- Renderer code follows the Suspense rules in `packages/app/AGENTS.md`: never read a resource in render without the `state` guard. An unguarded read makes the UI flash on first load.
- Renderer process should only reach the main process through `window.electron` (exposed by `src/preload`) and the MessagePort RPC client in `src/renderer/api.ts`.
- Main process should define IPC handlers in `src/main/ipc-handlers/*` and compose them in `src/main/ipc.ts`.
- Avoid FS operations where possible. For any desktop persistence prefer sqlite in most cases, as performance and EPERM and many other things, especially on windows can be quite painful. Using anything other than sqlite should come with strong reasons.

## Localization

Follow the Localization section of `packages/app/AGENTS.md`. It owns the shared rules for English source copy and translation review. In this package:

- Native menus, picker titles, dialogs, buttons, accessible labels, and displayed errors all need i18n keys.
- Renderer code resolves copy through the app language API. The main process consumes typed native-translation bundles through `nativeT(...)`; native menus, dialogs, and IPC handlers must not inspect locales, choose plural categories, or assemble translated sentence fragments.
- If native UI needs richer grammar, deepen the shared bundle/API instead of adding locale branches to desktop feature code.
