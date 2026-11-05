import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./markdown.fixture.tsx", import.meta.url))

story.beforeEach(async ({ mount }) => {
  const root = await mount("components-markdown--complete-response")
  await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
})

// The timeline observes data-markdown-ready, so each change of the attribute is a record here.
function recordReadiness(page: Page) {
  return page.evaluateHandle(() => {
    const markdown = document.querySelector('[data-testid="markdown-fixture"] [data-component="markdown"]')!
    const changes: boolean[] = []
    const observer = new MutationObserver((records) =>
      records.forEach((record) => changes.push(record.oldValue === null)),
    )
    observer.observe(markdown, { attributes: true, attributeFilter: ["data-markdown-ready"], attributeOldValue: true })

    // `true` adds the attribute, `false` removes it.
    return () => {
      observer.takeRecords().forEach((record) => changes.push(record.oldValue === null))

      return changes
    }
  })
}

story("keeps completed Markdown ready when an unrelated input reruns its render", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "```sh\necho hello\n```" })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  const readiness = await recordReadiness(page)

  await harness.getByLabel("German").check()
  await expect(markdown.getByRole("button", { name: "Kopieren" })).toHaveCount(1)
  // Before the machine, every rerun removed the attribute and added it again.
  expect(await readiness.evaluate((changes) => changes())).toEqual([])
  await readiness.dispose()
})

story("does not report a finished stream ready before its settled render checks paths", async ({ page }) => {
  const check = await page.evaluateHandle(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    const exists = Promise.withResolvers<boolean>()
    const requested: string[] = []
    await mountMarkdown({
      text: "Edit `src/file.ts`",
      streaming: true,
      localFileExists: (path: string) => {
        requested.push(path)

        return exists.promise
      },
    })

    return { requested, resolve: () => exists.resolve(true) }
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  const readiness = await recordReadiness(page)

  await harness.getByLabel("Streaming").uncheck()
  await expect.poll(() => check.evaluate((state) => state.requested)).toEqual(["src/file.ts"])
  await expect(markdown).not.toHaveAttribute("data-markdown-ready")
  await check.evaluate((state) => state.resolve())
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown.locator('code[data-inline-code-kind="path"]')).toHaveText("src/file.ts")
  // Before the machine, the last live render reported ready again before the settled render started its check.
  expect(await readiness.evaluate((changes) => changes())).toEqual([false, true])
  await readiness.dispose()
  await check.dispose()
})

story("reports completed Markdown ready when an inline path check never settles", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "Edit `src/file.ts`", localFileExists: () => new Promise<boolean>(() => {}) })
  }, fixture)
  const markdown = page.getByTestId("markdown-fixture").locator('[data-component="markdown"]')
  await expect(markdown.locator("code")).toHaveText("src/file.ts")
  await expect(markdown).not.toHaveAttribute("data-markdown-ready")
  // The check gives up after 2 s and leaves the path as plain code.
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown.locator("code")).not.toHaveAttribute("data-inline-code-kind")
})
