# Browser E2E Testing Guide (Vitest + Playwright)

## Commands

```bash
# Browser Vitest (hooks start Docker + Vite per file that uses useE2eStack)
bun run e2e

# Browser Vitest only (from packages/app; same Vitest config as `bun run e2e`)
bun run test:browser

# Single file (example)
bun run e2e -- test/browser/e2e/app/home.test.ts

# Install Chromium (CI / fresh machine)
bun run playwright:install

bun typecheck
```

## Layout

- Specs: `packages/app/test/browser/**/*.test.ts`
- Harness: `packages/app/test/browser/support/use-app-browser.ts` (Chromium `Page` + SDK)
- Stack hook: `packages/app/test/browser/support/use-e2e-stack.ts` — call **`useE2eStack()`** or **`useE2eStack({ reuse: false })`** once per file’s root `describe` before `useAppBrowser()` (Docker + OpenCode container + Vite).
- Waits / helpers: `packages/app/test/browser/support/wd-wait.ts`, `wd-actions.ts`
- SDK / selectors / URLs: `packages/app/e2e/actions.ts`, `selectors.ts`, `utils.ts`, `workos-auth.ts`

Use `useAppBrowser()` for `page`, `context`, `sdk`, `gotoSession`, `origin`, `project`. Requires `PLAYWRIGHT_BASE_URL` and API env vars (`e2e/utils.ts`) — set by **`useE2eStack()`** in the same `describe`.

Import helpers from `e2e/actions.ts` (`withSession`, `openSidebar`, `closeDialog`, …). Assertions use Vitest `expect` and `expect.poll` where needed.
