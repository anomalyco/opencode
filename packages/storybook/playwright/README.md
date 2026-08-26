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

Component browser coverage remains separate from each package's default `test` script and from `packages/app`'s `test:e2e`. Session UI uses port 6006 and app uses 6007, with a separate Vite dependency cache per port, so concurrent Turbo tasks do not compete for a server or overwrite each other's optimized modules. Set `PLAYWRIGHT_STORYBOOK_URL` to reuse an existing Storybook instance locally or `PLAYWRIGHT_STORYBOOK_PORT` to override a package's port; do not give concurrent server-owning tasks the same override.

## CI selection

The `test` workflow selects the suites independently using Turbo's affected workspace graph:

- App-only implementation, story, or component-test changes run app components and full-app E2E, not session-ui components.
- Session-ui changes run session-ui components and dependent app suites. Shared UI, client, util, and other workspace dependencies flow through the same graph.
- Affected Storybook harness code, config, mocks, fixtures, or stories run both component suites, without turning on full-app E2E solely for a harness change.
- The shared preview also imports app CSS and localization outside the package graph. App CSS, public assets, localization, and the bounded persistence/platform/server-scope/path-key dependency chain select both component suites. `script/github/browser-suites.test.ts` checks the preview's transitive runtime imports so this exception cannot silently become stale. The check conservatively follows the real platform module even where Storybook mocks it.
- Lockfiles, package manifests, TypeScript/Turbo configuration, root tooling, unknown non-documentation paths, manual dispatch, and Git/Turbo failures select all browser suites. Documentation-only changes outside affected browser workspaces skip them.

PR comparisons use the tested merge ref's first parent; pushes use the event's previous SHA. Both are normalized to a merge base, with deleted files and both sides of renames included. Each component suite runs on its own Linux runner. Existing Linux/Windows E2E check names and the `v2` ref exclusion are unchanged; selection does not override that exclusion, including on manual dispatch.

Run the selection matrix (real Git refs and Turbo, no browser or workspace install required):

```sh
cd script/github
bun test --root . browser-suites.test.ts
```

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

Component rendering and integration coverage can be complementary. A local story control that installs a completed message does not test event delivery, production reducer cleanup, or a live stream. Keep those original checks in E2E, including stream/chunk identity, compaction and retry events, independent lifecycle transitions, and the real app scroll owner. A provenance comment records the source of a component assertion; it is not evidence that its integration counterpart can be deleted.

When moving an assertion, preserve its discriminating fixture: file status kinds, empty/single-variant inputs, singleton groups, live message state, and the order of intermediate updates. Verify the actual scroll container overflows before asserting that keyboard activation does not scroll it.
