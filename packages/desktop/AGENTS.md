# Desktop package notes

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.
- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for native menus, picker titles, dialogs, buttons, accessible labels, and displayed errors. VeniceCode ships English only, but the dictionary keeps copy in one place instead of scattered across call sites.
- The English dictionaries are the source of truth: `packages/app/src/i18n/en.ts`, `packages/ui/src/i18n/en.ts`, `packages/desktop/src/renderer/i18n/en.ts`, and `DESKTOP_NATIVE_ENGLISH` in `packages/app/src/i18n/desktop-native.ts` for anything the main process renders.
- Do not add locale files or locale branching. `DESKTOP_NATIVE_LOCALES` is `["en"]`; widening it means restoring the loader machinery that was removed.
