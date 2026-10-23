import { expect, story } from "../../storybook/playwright/story"

for (const legacy of ["missing", "throws", "false", "success"] as const) {
  for (const modern of ["missing", "rejected", "success"] as const) {
    story(`copies tool errors: execCommand ${legacy}, navigator ${modern}`, async ({ mount, page }) => {
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      const root = await mount("components-tool-error-card--all")
      const card = root.locator('[data-kind="tool-error-card"]').first()
      if ((await card.getAttribute("data-open")) !== "true") {
        await card.locator('[data-slot="collapsible-trigger"]').click()
      }
      const button = card.getByRole("button", { name: "Copy error" })
      await expect(button).toBeVisible()
      const text = await card.locator('[data-slot="card-description"]').textContent()
      await page.evaluate(
        ({ legacy, modern }) => {
          document.body.dataset.copyCalls = "[]"
          document.body.dataset.writeCalls = "[]"
          Object.defineProperty(document, "execCommand", {
            configurable: true,
            value:
              legacy === "missing"
                ? undefined
                : (command: string) => {
                    document.body.dataset.copyCalls = JSON.stringify([
                      command,
                      document.querySelector<HTMLTextAreaElement>("textarea[readonly]")?.value,
                    ])
                    if (legacy === "throws") throw new Error("Legacy copy denied")
                    return legacy === "success"
                  },
          })
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value:
              modern === "missing"
                ? undefined
                : {
                    writeText: async (text: string) => {
                      document.body.dataset.writeCalls = JSON.stringify([text])
                      if (modern === "rejected") throw new Error("Clipboard denied")
                    },
                  },
          })
        },
        { legacy, modern },
      )

      await button.click()
      const success = legacy === "success" || modern === "success"
      await expect(card.getByRole("button", { name: success ? "Copied" : "Copy error", exact: true })).toBeVisible()
      expect(await page.locator("body").getAttribute("data-copy-calls")).toBe(
        JSON.stringify(legacy === "missing" ? [] : ["copy", text]),
      )
      expect(await page.locator("body").getAttribute("data-write-calls")).toBe(
        JSON.stringify(legacy === "success" || modern === "missing" ? [] : [text]),
      )
      await expect(page.locator("textarea[readonly]")).toHaveCount(0)
      expect(errors).toEqual([])
    })
  }
}
