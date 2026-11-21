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
  await expect(picker.getByRole("option")).toHaveCount(1)
  await expect(picker.getByRole("option")).toHaveAttribute("data-directory-path", "C:/OpenCode/Picker/alpha")

  const search = await holdRoute(page, /\/api\/fs\/find\?(.*&)?query=beta(&|$)/)
  await input.fill("beta")
  await search.arrived
  await expect(picker.getByRole("option")).toHaveCount(0)

  await input.press("Tab")
  await expect(input).toHaveValue("beta")

  await input.press("Enter")
  await expect(input).toHaveValue("C:\\OpenCode\\Picker\\beta\\")
  await expect(picker.getByRole("treeitem", { name: "beta", exact: true })).toHaveAttribute("aria-selected", "true")
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

test("Escape closes suggestions, then drops a typed path, before it closes the picker", async ({ page }) => {
  const picker = await openPicker(page, {
    fileList: (path) =>
      path === directory ? ["alpha", "beta"].map((name) => fileNode(directory, name, "directory")) : [],
    findFiles: (input) => ["alpha", "beta"].filter((name) => input.query.length >= 3 && name.startsWith(input.query)),
  })

  const input = picker.getByRole("combobox")

  await picker.getByRole("treeitem", { name: "beta", exact: true }).click()
  await expect(input).toHaveValue("C:\\OpenCode\\Picker\\beta\\")

  await input.fill("alp")
  await expect(picker.getByRole("option")).toHaveCount(1)
  await input.press("Escape")
  await expect(picker.getByRole("option")).toHaveCount(0)
  await expect(input).toHaveValue("alp")

  await input.press("Escape")
  await expect(picker).toBeVisible()
  await expect(input).toHaveValue("C:\\OpenCode\\Picker\\beta\\")
  await expect(picker.getByRole("treeitem", { name: "beta", exact: true })).toHaveAttribute("aria-selected", "true")

  await input.press("Escape")
  await expect(picker).toBeHidden()
})

function markerOpacities(page: Page, name: string) {
  return page.evaluate((name) => {
    const host = document.querySelector<HTMLElement>(".directory-picker-tree")
    const rows = host?.shadowRoot
      ? Array.from(host.shadowRoot.querySelectorAll<HTMLElement>('button[data-type="item"]')).filter(
          (item) => item.dataset.fileTreeStickyRow !== "true",
        )
      : []
    const row = rows.find((item) => item.getAttribute("aria-label") === name)
    const markers = row ? Array.from(row.querySelectorAll<HTMLElement>("[data-truncate-marker]")) : []

    return markers.map((marker) => getComputedStyle(marker).opacity)
  }, name)
}

test("the picker does not paint truncation markers at fractional UI zoom", async ({ page }) => {
  const longName = "a-folder-name-that-does-not-fit"
  const picker = await openPicker(page, {
    fileList: (path) =>
      path === directory ? ["alpha", longName].map((name) => fileNode(directory, name, "directory")) : [],
  })

  await expect(picker.getByRole("treeitem", { name: "alpha", exact: true })).toBeVisible()
  // The desktop app zooms through Electron; CSS zoom reproduces the same
  // container-query flip in the browser test. Disable the marker fade so the
  // settled opacity is observable without a wall-clock wait.
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".directory-picker-tree")

    host?.style.setProperty("--truncate-marker-fade-in-duration", "0s")
    host?.style.setProperty("--truncate-marker-fade-out-duration", "0s")
    document.body.style.zoom = "1.1"
  })

  // Wait for the fractional layout that puts the marker cell inside the 1px
  // rounding band this fix targets. This also proves the test reproduced it.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1
        const host = document.querySelector<HTMLElement>(".directory-picker-tree")
        const rows = host?.shadowRoot
          ? Array.from(host.shadowRoot.querySelectorAll<HTMLElement>('button[data-type="item"]')).filter(
              (item) => item.dataset.fileTreeStickyRow !== "true",
            )
          : []
        const row = rows.find((item) => item.getAttribute("aria-label") === "alpha")
        const markers = row ? Array.from(row.querySelectorAll<HTMLElement>("[data-truncate-marker]")) : []
        const cells = row ? Array.from(row.querySelectorAll<HTMLElement>("[data-truncate-marker-cell]")) : []
        const oneLine = markers[0] ? markers[0].getBoundingClientRect().height / zoom : undefined

        if (oneLine == null) return false

        return cells.some((cell) => {
          const height = cell.getBoundingClientRect().height / zoom

          return height > oneLine && height <= oneLine + 1
        })
      }),
    )
    .toBe(true)

  await expect
    .poll(async () => {
      const opacities = await markerOpacities(page, "alpha")

      return opacities.length > 0 && opacities.every((opacity) => opacity === "0")
    })
    .toBe(true)

  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".directory-picker-tree")

    if (host) host.style.width = "72px"
  })

  await expect
    .poll(async () => {
      const opacities = await markerOpacities(page, longName)

      return opacities.includes("1")
    })
    .toBe(true)
})
