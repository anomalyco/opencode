# Component browser tests

Production Solid components are tested through the states of their existing `*.lab.tsx` Lab pages without booting the app, configuring a server, seeding browser storage, or navigating unrelated routes.

To browse the full Lab in a browser, run `bun run --cwd packages/lab dev` from the repo root and open <http://localhost:6006/> (or the port Vite prints). The tree, grid, and inspector use the same fixtures as the individual `/?id=…` state frames.

Keep each spec in the package that owns its production component:

- `packages/session-ui/component-tests/` owns timeline, tool, notice, reasoning, lifecycle, and review coverage.
- `packages/app/component-tests/` owns Composer and other app-only component coverage.
- `packages/lab/` owns the Lab server (a plain Vite page that renders one state with fixed data in place of the server, router and project), the shared Playwright configuration and the `test` fixture with `mount`.

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
bun turbo test:components --filter=@opencode/session-ui
bun turbo test:components --filter=@opencode/app
```

Component browser coverage deliberately remains separate from each package's default `test` script and from `packages/app`'s `test:e2e`, so expensive browser checks can be scheduled independently from required unit and full-app journey CI. CI runs each suite in its own leg of the `e2e` job in `.github/workflows/check-test.yml` (`session-ui-components` and `app-components`). Set `PLAYWRIGHT_LAB_URL` to reuse a running Lab server (`bun --cwd packages/lab dev`) or `PLAYWRIGHT_LAB_PORT` to choose its port.

## Adding a test

Keep inspectable scenarios next to the production component in a `*.lab.tsx` Lab page. A page owns its fixtures, providers, states, and callbacks; its package-local spec owns user-visible interactions and assertions.

```ts
import { expect, test } from "../../lab/playwright/test"

// Moved from packages/app/e2e/regression/session-timeline-context-state.spec.ts
test("preserves collapsed state while a tool completes", async ({ mount }) => {
  const component = await mount("current-session-research-agents--agent-research", {
    args: { scenario: "exploration" },
  })
  const trigger = component.locator('[data-slot="collapsible-trigger"]')

  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await component.getByRole("button", { name: "Complete read" }).click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})
```

The state ID is the page's meta `id` (or its title, kebab-cased) followed by `--` and the kebab-cased state export, as Storybook named them. It doesn't depend on the file name. Open `http://127.0.0.1:6006/?id=<state id>` on a running Lab server, or the page in the app's Lab, to inspect exactly the scenario covered by the browser test. Preserve an original-source-path comment for every migrated E2E case.

Keep cross-route navigation, remote-server ownership, persistent session state, full-app virtualization, and workflows spanning independent surfaces in `packages/app/e2e/`.

Component rendering and integration coverage can be complementary. A local page control that installs a completed message does not test event delivery, production reducer cleanup, or a live stream. Keep those original checks in E2E, including stream/chunk identity, compaction and retry events, independent lifecycle transitions, and the real app scroll owner. A provenance comment records the source of a component assertion; it is not evidence that its integration counterpart can be deleted.

When moving an assertion, preserve its discriminating fixture: file status kinds, empty/single-variant inputs, singleton groups, live message state, and the order of intermediate updates. Verify the actual scroll container overflows before asserting that keyboard activation does not scroll it.
