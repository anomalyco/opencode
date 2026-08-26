# Component browser tests

These tests exercise production Solid components through their existing Storybook stories. Unlike `e2e/`, they do not boot the app, configure a server, seed browser storage, or navigate through unrelated routes.

```sh
# Start Storybook automatically and run all component tests.
bun run test:components

# Run one component spec.
bun run test:components -- component-tests/session-timeline.spec.ts

# Explore the suite in Playwright's UI.
bun run test:components:ui
```

The tests are deliberately separate from `bun run test:e2e`, so CI can run app-wide user journeys without running component appearance and interaction coverage. Set `PLAYWRIGHT_STORYBOOK_URL` to reuse an existing Storybook instance or `PLAYWRIGHT_STORYBOOK_PORT` to choose its port.

## Adding a test

Keep scenarios next to the production component in a `*.stories.tsx` file. A story owns its fixtures, providers, state, and callbacks; the test owns user-visible interactions and assertions.

```ts
import { expect, story } from "./story"

story("preserves collapsed state while a tool completes", async ({ mount }) => {
  const component = await mount("current-session-context-projection--collapsed-during-status-updates")
  const trigger = component.locator('[data-slot="collapsible-trigger"]')

  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await component.getByRole("button", { name: "Complete read" }).click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})
```

The story ID is the Storybook component ID followed by `--` and the kebab-cased story export. Open the same story in Storybook to inspect and interact with exactly the scenario the browser test covers.

Keep cross-route navigation, remote-server ownership, persistent session state, and workflows spanning independent surfaces in `e2e/`.
