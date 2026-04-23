# E2E Testing Guide

## Build/Lint/Test Commands

```bash
# Run all e2e tests
bun test:e2e

# Run specific test file
bun test:e2e -- app/home.spec.ts

# Run single test by title
bun test:e2e -- -g "home renders and shows core entrypoints"

# Run tests with UI mode (for debugging)
bun test:e2e:ui

# Run tests locally with full server setup
bun test:e2e:local

# View test report
bun test:e2e:report

# Typecheck
bun typecheck
```

## Test Structure

All tests live in `packages/app/e2e/`:

```
e2e/
├── fixtures.ts       # Test fixtures (test, expect, gotoSession, sdk)
├── actions.ts        # Reusable action helpers
├── selectors.ts      # DOM selectors
├── utils.ts          # Utilities (serverUrl, modKey, path helpers)
└── [feature]/
    └── *.spec.ts     # Test files
```

## Test Patterns

### Basic Test Structure

```typescript
import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

test("test description", async ({ page, sdk, gotoSession }) => {
  await gotoSession() // or gotoSession(sessionID)

  // Your test code
  await expect(page.locator(promptSelector)).toBeVisible()
})
```

### Using Fixtures

- `page` - Playwright page
- `llm` - Mock LLM server for queuing responses (`text`, `tool`, `toolMatch`, `textMatch`, etc.)
- `project` - Golden-path project fixture (call `project.open()` first, then use `project.sdk`, `project.prompt(...)`, `project.gotoSession(...)`, `project.trackSession(...)`)
- `sdk` - OpenCode SDK client for API calls (worker-scoped, shared directory)
- `gotoSession(sessionID?)` - Navigate to session (worker-scoped, shared directory)

### Helper Functions

**Actions** (`actions.ts`):

- `openPalette(page)` - Open command palette
- `openSettings(page)` - Open settings dialog
- `closeDialog(page, dialog)` - Close any dialog
- `openSidebar(page)` / `closeSidebar(page)` - Toggle sidebar
- `waitTerminalReady(page, { term? })` - Wait for a mounted terminal to connect and finish rendering output
- `runTerminal(page, { cmd, token, term?, timeout? })` - Type into the terminal via the browser and wait for rendered output
- `withSession(sdk, title, callback)` - Create temp session
- `sessionIDFromUrl(url)` - Read session ID from URL
- `slugFromUrl(url)` - Read workspace slug from URL
- `waitSlug(page, skip?)` - Wait for resolved workspace slug
- `clickListItem(container, filter)` - Click list item by key/text

**Selectors** (`selectors.ts`):

- `promptSelector` - Prompt input
- `terminalSelector` - Terminal panel
- `sessionItemSelector(id)` - Session in sidebar
- `listItemSelector` - Generic list items

**Utils** (`utils.ts`):

- `modKey` - Meta (Mac) or Control (Linux/Win)
- `serverUrl` - Backend server URL
- `sessionPath(dir, id?)` - Build session URL

## Code Style Guidelines

### Imports

Always import from `../fixtures`, not `@playwright/test`:

```typescript
// ✅ Good
import { test, expect } from "../fixtures"

// ❌ Bad
import { test, expect } from "@playwright/test"
```

### Naming Conventions

- Test files: `feature-name.spec.ts`
- Test names: lowercase, descriptive: `"sidebar can be toggled"`
- Variables: camelCase
- Constants: SCREAMING_SNAKE_CASE

### Error Handling

Tests should clean up after themselves. Prefer fixture-managed cleanup:

```typescript
test("test with cleanup", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "test session", async (session) => {
    await gotoSession(session.id)
    // Test code...
  }) // Auto-deletes session
})
```

- Prefer the `project` fixture for tests that need a dedicated project with LLM mocking — call `project.open()` then use `project.prompt(...)`, `project.trackSession(...)`, etc.
- Use `withSession(sdk, title, callback)` for lightweight temp sessions on the shared worker directory
- Call `project.trackSession(sessionID, directory?)` and `project.trackDirectory(directory)` for any resources created outside the fixture so teardown can clean them up
- Avoid calling `sdk.session.delete(...)` directly

### Timeouts

Default: 60s per test, 10s per assertion. Override when needed:

```typescript
test.setTimeout(120_000) // For long LLM operations
test("slow test", async () => {
  await expect.poll(() => check(), { timeout: 90_000 }).toBe(true)
})
```

### Selectors

Use `data-component`, `data-action`, or semantic roles:

```typescript
// ✅ Good
await page.locator('[data-component="prompt-input"]').click()
await page.getByRole("button", { name: "Open settings" }).click()

// ❌ Bad
await page.locator(".css-class-name").click()
await page.locator("#id-name").click()
```

### Keyboard Shortcuts

Use `modKey` for cross-platform compatibility:

```typescript
import { modKey } from "../utils"

await page.keyboard.press(`${modKey}+B`) // Toggle sidebar
await page.keyboard.press(`${modKey}+Comma`) // Open settings
```

### Terminal Tests

- In terminal tests, type through the browser. Do not write to the PTY through the SDK.
- Use `waitTerminalReady(page, { term? })` and `runTerminal(page, { cmd, token, term?, timeout? })` from `actions.ts`.
- These helpers use the fixture-enabled test-only terminal driver and wait for output after the terminal writer settles.
- After opening the terminal, use `waitTerminalFocusIdle(...)` before the next keyboard action when prompt focus or keyboard routing matters.
- This avoids racing terminal mount, focus handoff, and prompt readiness when the next step types or sends shortcuts.
- Avoid `waitForTimeout` and custom DOM or `data-*` readiness checks.

### Wait on state

- Never use wall-clock waits like `page.waitForTimeout(...)` to make a test pass
- Avoid race-prone flows that assume work is finished after an action
- Wait or poll on observable state with `expect(...)`, `expect.poll(...)`, or existing helpers
- Prefer locator assertions like `toBeVisible()`, `toHaveCount(0)`, and `toHaveAttribute(...)` for normal UI state, and reserve `expect.poll(...)` for probe, mock, or backend state
- Prefer semantic app state over transient DOM visibility when behavior depends on active selection, focus ownership, or async retry loops
- Do not treat a visible element as proof that the app will route the next action to it
- When fixing a flake, validate with `--repeat-each` and multiple workers when practical

### Add hooks

- If required state is not observable from the UI, add a small test-only driver or probe in app code instead of sleeps or fragile DOM checks
- Keep these hooks minimal and purpose-built, following the style of `packages/app/src/testing/terminal.ts`
- Test-only hooks must be inert unless explicitly enabled; do not add normal-runtime listeners, reactive subscriptions, or per-update allocations for e2e ceremony
- When mocking routes or APIs, expose explicit mock state and wait on that before asserting post-action UI
- Add minimal test-only probes for semantic state like the active list item or selected command when DOM intermediates are unstable
- Prefer probing committed app state over asserting on transient highlight, visibility, or animation states

### Prefer helpers

- Prefer fluent helpers and drivers when they make intent obvious and reduce locator-heavy noise
- Use direct locators when the interaction is simple and a helper would not add clarity
- Prefer helpers that both perform an action and verify the app consumed it
- Avoid composing helpers redundantly when one already includes the other or already waits for the resulting state
- If a helper already covers the required wait or verification, use it directly instead of layering extra clicks, keypresses, or assertions

## Writing New Tests

1. Choose appropriate folder or create new one
2. Import from `../fixtures`
3. Use helper functions from `../actions` and `../selectors`
4. When validating routing, use shared helpers from `../actions`. Workspace URL slugs can be canonicalized on Windows, so assert against canonical or resolved workspace slugs.
5. Clean up any created resources
6. Use specific selectors (avoid CSS classes)
7. Test one feature per test file

## Local Development

For UI debugging, use:

```bash
bun test:e2e:ui
```

This opens Playwright's interactive UI for step-through debugging.
