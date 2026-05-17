# Browser E2E Testing Guide (Vitest + Selenium WebDriver)

## Commands

```bash
# Run all browser e2e tests (Vitest)
bun test:e2e

# Same as above (alias)
bun run test:e2e:wd

# Watch mode
bun run test:e2e:wd:watch

# Single file
bun run vitest run test/browser/e2e/app/home.test.ts

# Full Docker-backed stack + Vitest
bun test:e2e:local

bun typecheck
```

## Layout

- Specs: `packages/app/test/browser/**/*.test.ts`
- Shared WD helpers: `packages/app/test/browser/support/`
- SDK / selectors / URLs: `packages/app/e2e/actions.ts`, `selectors.ts`, `utils.ts`, `workos-auth.ts`

Use `useAppWebDriver()` for `driver`, `sdk`, `gotoSession`, `origin`, `project`. Requires `PLAYWRIGHT_BASE_URL` and API env vars (`e2e/utils.ts`).

Import SDK helpers from `e2e/actions.ts` (`withSession`, `cleanupSession`, `seedSessionQuestion`, `seedProjectsWebDriver`, …). Do **not** import removed Playwright `fixtures.ts`.
