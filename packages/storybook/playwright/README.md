# Component browser tests

Production Solid components are tested through their existing Storybook stories without booting the app, configuring a server, seeding browser storage, or navigating unrelated routes.

Keep each spec in the package that owns its production component:

- `packages/session-ui/component-tests/` owns timeline, tool, notice, reasoning, lifecycle, and review coverage.
- `packages/app/component-tests/` owns Composer and other app-only component coverage.
- `packages/storybook/playwright/` owns the shared Storybook startup configuration and `story` mount fixture.

Run a package's isolated browser suite from that package:

```sh
# Session UI components.
cd packages/session-ui
bun run test:components
bun run test:components -- component-tests/session-timeline.spec.ts
bun run test:components:ui

# App-owned components.
cd packages/app
bun run test:components
bun run test:components -- component-tests/composer.spec.ts
```

Both suites are separately filterable Turbo tasks:

```sh
bun turbo test:components --filter=@opencode-ai/session-ui
bun turbo test:components --filter=@opencode-ai/app
```

Component browser coverage deliberately remains separate from each package's default `test` script and from `packages/app`'s `test:e2e`, so expensive Storybook checks can be scheduled independently from required unit and full-app journey CI. Set `PLAYWRIGHT_STORYBOOK_URL` to reuse an existing Storybook instance or `PLAYWRIGHT_STORYBOOK_PORT` to choose its port.

## Adding a test

Keep inspectable scenarios next to the production component in a `*.stories.tsx` file. A story owns its fixtures, providers, state, and callbacks; its package-local spec owns user-visible interactions and assertions.

```ts
import { expect, story } from "../../storybook/playwright/story"

// Moved from packages/app/e2e/regression/session-timeline-context-state.spec.ts
story("preserves collapsed state while a tool completes", async ({ mount }) => {
  const component = await mount("current-session-research-agents--agent-research", {
    args: { scenario: "exploration" },
  })
  const trigger = component.locator('[data-slot="collapsible-trigger"]')

  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await component.getByRole("button", { name: "Complete read" }).click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})
```

The story ID is the Storybook component ID followed by `--` and the kebab-cased story export. Open the same story in Storybook to inspect exactly the scenario covered by the browser test. Preserve an original-source-path comment for every migrated E2E case.

Keep cross-route navigation, remote-server ownership, persistent session state, full-app virtualization, and workflows spanning independent surfaces in `packages/app/e2e/`.
