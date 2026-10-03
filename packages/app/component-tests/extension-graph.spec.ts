import { fileURLToPath } from "node:url"
import type { Definition } from "@opencode/gui-extensions/sdk"
import { expect, story } from "../../storybook/playwright/story"

const source = (path: string) => `/@fs/${fileURLToPath(new URL(path, import.meta.url)).replaceAll("\\", "/")}`

const modules = {
  fixture: source("./extension-host.fixture.tsx"),
  builtins: source("../../gui-extensions/src/renderer.ts"),
}

story.beforeEach(async ({ mount }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
})

// The built-in renderer composition as a graph: `requires` edges must not form a cycle, and every optional (`uses`)
// edge gets one row that boots the real host with that provider disabled. The first row disables nothing.
story("built-ins: no requires cycle, and each consumer activates without each optional provider", async ({ page }) => {
  const result = await page.evaluate(async (modules) => {
    const [{ mountExtensions, until }, { builtins }] = await Promise.all([
      import(modules.fixture),
      import(modules.builtins),
    ])

    // The window this host serves has no OS, so OS-specific built-ins are left out as the app leaves them out.
    const composition: readonly Definition[] = builtins
    const definitions = composition.filter((definition) => !definition.os)
    const ids = (tokens: Definition["provides"]) => Object.values(tokens ?? {}).map((token) => token.id)
    const providerOf = (token: string) => definitions.find((definition) => ids(definition.provides).includes(token))?.id

    const requires = new Map(
      definitions.map((definition) => [
        definition.id,
        ids(definition.requires).flatMap((token) => providerOf(token) ?? []),
      ]),
    )

    const cycles = definitions.flatMap((definition) => {
      const walk = (id: string, path: readonly string[]): string[][] =>
        path.includes(id)
          ? id === definition.id
            ? [[...path, id]]
            : []
          : (requires.get(id) ?? []).flatMap((next) => walk(next, [...path, id]))

      return walk(definition.id, [])
    })

    // A renderer that uses the Ipc its own main entry provides depends on no other extension.
    const edges = definitions.flatMap((consumer) =>
      ids(consumer.uses).flatMap((token) => {
        const provider = providerOf(token)

        return provider && provider !== consumer.id ? [{ consumer: consumer.id, provider, token }] : []
      }),
    )

    const rows = [{ consumer: "*", provider: "", token: "" }, ...edges]
    const outcomes = []

    for (const row of rows) {
      const host = mountExtensions({ definitions, disabled: row.provider ? [row.provider] : [] })
      host.release()
      await until(() => host.ready())
      const consumers = row.consumer === "*" ? definitions.map((definition) => definition.id) : [row.consumer]
      outcomes.push({
        ...row,
        results: consumers.map((id) => ({ id, status: host.status(id), failure: host.failure(id)?.error ?? null })),
      })
      host.unmount()
    }

    return { cycles, outcomes }
  }, modules)

  expect(result.cycles).toEqual([])
  expect(result.outcomes).toEqual(
    result.outcomes.map((outcome) => ({
      ...outcome,
      results: outcome.results.map((item) => ({ id: item.id, status: "active", failure: null })),
    })),
  )
})
