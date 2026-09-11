import { expect, story } from "../../storybook/playwright/story"

for (const split of [false, true]) {
  for (const theme of ["light", "dark"]) {
    story(`highlights changed words in ${split ? "split" : "unified"} ${theme} diffs`, async ({ mount }) => {
      const root = await mount("components-session-review--inline-changes", { args: { split }, globals: { theme } })
      const diffs = root.locator("diffs-container")
      await expect(diffs).toHaveCount(2)
      for (const diff of await diffs.all()) {
        await expect(diff.locator('[data-line] [style*="--syntax-"]')).not.toHaveCount(0)
      }
      const additions = root.locator('[data-line-type="change-addition"] [data-diff-span]')
      await expect(additions).toHaveText(["select-text"])
      await expect(root.locator('[data-line-type="context"] [data-diff-span]')).toHaveCount(0)
      await expect(root.locator('[data-line-type="change-deletion"] [data-diff-span]')).toHaveText([
        '"http" in',
        "? error.reason.",
        "response?.",
        ": undefined",
      ])
      await expect(additions).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    })
  }

  for (const source of ["files", "metadata"]) {
    story(`skips word diffs for large ${split ? "split" : "unified"} ${source}`, async ({ mount }) => {
      const root = await mount("components-session-review--large-file", { args: { split, source } })
      const line = root.locator('[data-line][data-line-type="change-addition"]')
      await expect(line).toHaveText("export const value = 'after'")
      // Plain first paint is not proof that the worker kept inline diffs disabled.
      await expect(line.locator('[style*="--syntax-"]')).not.toHaveCount(0)
      await expect(root.locator("[data-diff-span]")).toHaveCount(0)
    })
  }
}
