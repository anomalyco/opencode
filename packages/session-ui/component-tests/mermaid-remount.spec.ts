import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./markdown.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`
const text = "```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```"

for (const options of [{ streaming: true }, { streaming: false }, { streaming: false, cached: true }]) {
  story(`Mermaid survives remount with ${JSON.stringify(options)}`, async ({ page, mount }) => {
    await mount("components-markdown--complete-response")
    await page.evaluate(
      async ({ fixture, text, options }) => {
        const { mountMarkdown } = await import(fixture)
        await mountMarkdown({ text, ...options })
      },
      { fixture, text, options },
    )
    const harness = page.getByTestId("markdown-fixture")
    const diagram = harness.locator('[data-component="markdown-mermaid"] svg')
    await expect(diagram).toBeVisible()
    if (options.streaming) await harness.getByLabel("Streaming").uncheck()
    await expect(diagram).toBeVisible()
    await harness.getByRole("button", { name: "Toggle Markdown" }).click()
    await expect(diagram).toHaveCount(0)
    await harness.getByRole("button", { name: "Toggle Markdown" }).click()
    await expect(harness.locator("pre code")).toContainText("flowchart LR")
    await expect(diagram).toBeVisible()
    await expect(harness.locator("pre")).not.toBeVisible()
    await expect(diagram).toContainText("Start")
    await expect(diagram).toContainText("Done")
    await expect(harness.getByRole("button", { name: "Toggle Markdown" })).toBeFocused()
  })
}

story("completed Mermaid keeps other code and invalid diagrams readable", async ({ page, mount }) => {
  await mount("components-markdown--complete-response")
  await page.evaluate(
    async ({ fixture, text }) => {
      const { mountMarkdown } = await import(fixture)
      await mountMarkdown({ text, cached: true })
    },
    {
      fixture,
      text: `${text}\n\n${text}\n\n\`\`\`ts\nconst answer = 42\n\`\`\`\n\n\`\`\`mermaid\nnot a diagram\n\`\`\``,
    },
  )
  const harness = page.getByTestId("markdown-fixture")
  await expect(harness.locator('[data-component="markdown-mermaid"] svg')).toHaveCount(2)
  await expect(harness.locator("pre").filter({ hasText: "const answer = 42" })).toBeVisible()
  await expect(harness.locator("pre").filter({ hasText: "not a diagram" })).toBeVisible()
  await harness.getByLabel("Markdown text").fill("Replacement prose")
  await expect(harness.locator('[data-component="markdown"]')).toHaveText("Replacement prose")
  await expect(harness.locator("svg, pre")).toHaveCount(0)
})
