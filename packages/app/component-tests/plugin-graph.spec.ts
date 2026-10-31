import { expect, sourceURL, story } from "../../stories/playwright/story"
import type { Entry } from "@opencode/plugin/gui/host"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("./plugin-host.fixture.tsx"),
  builtins: source("../../gui-plugins/src/renderer.ts"),
}

story.beforeEach(async ({ mount }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
})

// Built-ins read each other's contracts at runtime with `ctx.use`, so each must keep working without any other. Every
// row boots the real host with one built-in disabled; the first row disables nothing.
story("built-ins: each activates without each other built-in", async ({ page }) => {
  const outcomes = await page.evaluate(async (modules) => {
    const [{ mountPlugins, until }, { builtins }] = await Promise.all([
      import(modules.fixture),
      import(modules.builtins),
    ])

    // The window this host serves has no OS, so OS-specific built-ins are left out as the app leaves them out.
    const composition: readonly Entry[] = builtins
    const definitions = composition.filter((definition) => !definition.os)
    const rows = ["", ...definitions.map((definition) => definition.id)]
    const results = []

    for (const disabled of rows) {
      const host = mountPlugins({ definitions, disabled: disabled ? [disabled] : [] })
      host.release()
      await until(() => host.ready())
      results.push({
        disabled,
        results: definitions.flatMap((definition) =>
          definition.id === disabled
            ? []
            : [
                {
                  id: definition.id,
                  status: host.status(definition.id),
                  failure: host.failure(definition.id)?.error ?? null,
                },
              ],
        ),
      })
      host.unmount()
    }

    return results
  }, modules)

  expect(outcomes).toEqual(
    outcomes.map((outcome) => ({
      ...outcome,
      results: outcome.results.map((item) => ({ id: item.id, status: "active", failure: null })),
    })),
  )
})
