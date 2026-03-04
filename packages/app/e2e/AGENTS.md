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
- `sdk` - OpenCode SDK client for API calls
- `gotoSession(sessionID?)` - Navigate to session

### Helper Functions

**Actions** (`actions.ts`):

- `openPalette(page)` - Open command palette
- `openSettings(page)` - Open settings dialog
- `closeDialog(page, dialog)` - Close any dialog
- `openSidebar(page)` / `closeSidebar(page)` - Toggle sidebar
- `withSession(sdk, title, callback)` - Create temp session
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

Tests should clean up after themselves:

```typescript
test("test with cleanup", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "test session", async (session) => {
    await gotoSession(session.id)
    // Test code...
  }) // Auto-deletes session
})
```

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

## Writing New Tests

1. Choose appropriate folder or create new one
2. Import from `../fixtures`
3. Use helper functions from `../actions` and `../selectors`
4. Clean up any created resources
5. Use specific selectors (avoid CSS classes)
6. Test one feature per test file

## Local Development

For UI debugging, use:

```bash
bun test:e2e:ui
```

This opens Playwright's interactive UI for step-through debugging.
