import type { mountCodeBlocks } from "./plugin-host.fixture"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./plugin-host.fixture.tsx", import.meta.url))

type CodeBlocksHost = ReturnType<typeof mountCodeBlocks>

story.beforeEach(async ({ page }) => {
  await page.goto("/")
})

story("the appearance setting applies to blocks already shown", async ({ page }) => {
  const host = await page.evaluateHandle(async (fixture) => {
    const { builtins, mountCodeBlocks, until } = await import(fixture)
    const visual = builtins.find((entry: { id: string }) => entry.id === "visual")

    if (!visual) throw new Error("The visual built-in is missing.")

    const host: CodeBlocksHost = mountCodeBlocks({ definitions: [visual] })

    await until(() => host.status("visual") === "active")
    host.show(
      '```visual\n{"v":1,"kind":"plot","title":"Stress amplitude","unit":"MPa","data":{"x":{"label":"cycles"},"y":{"label":"stress"},"series":[{"label":"S275","points":[[1000,420],[10000,330],[100000,275]]}]}}\n```\n',
    )

    return host
  }, fixture)

  const block = page.getByTestId("code-blocks").locator('[data-component="markdown-code"]').first()

  await expect(block.getByRole("heading", { name: "Stress amplitude" })).toBeVisible()

  await host.evaluate((host) => host.visuals("off"))
  await expect(block.locator(".vz")).toHaveCount(0)
  await expect(block).toContainText('"kind":"plot"')

  await host.evaluate((host) => host.visuals("inline"))
  await expect(block.getByRole("heading", { name: "Stress amplitude" })).toBeVisible()
})
