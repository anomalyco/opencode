import { expect, test } from "@playwright/test"
import { fileNode, openSettings } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 } })

test("the folder picker's tree scrolls with the mouse wheel inside the modal", async ({ page }) => {
  const directory = "/projects/big"
  let listing = false

  await openSettings(page, {
    name: "Picker",
    directory,
    fileList: () =>
      listing
        ? Array.from({ length: 500 }, (_, index) =>
            fileNode(directory, `dir-${String(index).padStart(3, "0")}`, "directory"),
          )
        : [],
    seed: { tabs: [] },
  })
  await page.getByTestId("settings-screen").getByRole("tab", { name: "Projects", exact: true }).click()
  listing = true
  await page.getByRole("button", { name: "Add project", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })

  const scrollTop = () =>
    page.evaluate(
      () =>
        document
          .querySelector(".directory-picker-tree")
          ?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]")?.scrollTop,
    )

  await expect.poll(scrollTop).toBe(0)
  const browser = await picker.locator(".directory-picker-browser").boundingBox()
  await page.mouse.move(browser!.x + browser!.width / 2, browser!.y + browser!.height / 2)
  await page.mouse.wheel(0, 300)
  await expect.poll(scrollTop).toBeGreaterThan(0)
})
