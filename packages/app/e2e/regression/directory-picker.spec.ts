import { expect, test, type Page } from "@playwright/test"
import { holdRoute } from "../utils/app"
import type { MockServerConfig } from "../utils/mock-server"
import { fileNode, openSettings } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 } })

const directory = "C:/OpenCode/Picker"

// Opens the folder picker from Settings > Projects once its root has listed.
async function openPicker(page: Page, input: Pick<MockServerConfig, "fileList" | "findFiles">) {
  await openSettings(page, { name: "Picker", seed: { tabs: [] }, ...input })
  await page.getByTestId("settings-screen").getByRole("tab", { name: "Projects", exact: true }).click()
  await page.getByRole("button", { name: "Add project", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()

  return picker
}

test("Tab and Enter while suggestions load act on the typed folder, not the previous suggestions", async ({ page }) => {
  const picker = await openPicker(page, {
    fileList: (path) =>
      path === directory ? ["alpha", "beta"].map((name) => fileNode(directory, name, "directory")) : [],
    findFiles: (input) => ["alpha", "beta"].filter((name) => input.query.length >= 3 && name.startsWith(input.query)),
  })

  const input = picker.getByRole("combobox")

  await input.fill("alp")
  await expect(picker.getByRole("option")).toHaveText(["C:\\OpenCode\\Picker\\alpha/"])

  const search = await holdRoute(page, /\/api\/fs\/find\?(.*&)?query=beta(&|$)/)
  await input.fill("beta")
  await search.arrived
  await expect(picker.getByRole("option")).toHaveCount(0)

  await input.press("Tab")
  await expect(input).toHaveValue("beta")

  await input.press("Enter")
  await expect(input).toHaveValue("C:\\OpenCode\\Picker\\beta\\")
  await expect(picker.locator(".directory-picker-selection-text")).toHaveText("C:\\…\\Picker\\beta")
  search.release()
})

test("a folder that cannot be listed leaves the root readable and retries when expanded", async ({ page }) => {
  let failures = 0

  const picker = await openPicker(page, {
    fileList: (path) => {
      if (path === `${directory}/locked`) {
        failures += 1

        return Promise.reject(new Error("Permission denied"))
      }

      return path === directory ? ["locked", "open"].map((name) => fileNode(directory, name, "directory")) : []
    },
  })

  // The root preloads its folders, so the locked one fails once before the user touches it.
  await expect.poll(() => failures).toBe(1)
  await picker.getByRole("treeitem", { name: "locked", exact: true }).click()
  await expect.poll(() => failures).toBe(2)

  await expect(picker.getByText("Unable to read this folder")).toHaveCount(0)
  await expect(picker.getByRole("treeitem", { name: "open", exact: true })).toBeVisible()
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
})

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
