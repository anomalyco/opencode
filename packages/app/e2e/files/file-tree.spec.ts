import { test, expect } from "../fixtures"

test("file tree can expand folders and open a file", async ({ page, gotoSession }) => {
  await gotoSession()

  const toggle = page.getByRole("button", { name: "Toggle file tree" })
  const panel = page.locator("#file-tree-panel")
  const treeTabs = panel.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')

  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(panel).toBeVisible()
  await expect(treeTabs).toBeVisible()

  const allTab = treeTabs.getByRole("tab", { name: /^all files$/i })
  await expect(allTab).toBeVisible()
  await allTab.click()
  await expect(allTab).toHaveAttribute("aria-selected", "true")

  const tree = treeTabs.locator('[data-slot="tabs-content"]:not([hidden])')
  await expect(tree).toBeVisible()

  const expand = async (name: string) => {
    const folder = tree.getByRole("button", { name, exact: true }).first()
    await expect(folder).toBeVisible()
    await expect(folder).toHaveAttribute("aria-expanded", /true|false/)
    if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click()
    await expect(folder).toHaveAttribute("aria-expanded", "true")
  }

  await expand("packages")
  await expand("app")
  await expand("src")
  await expand("components")

  const file = tree.getByRole("button", { name: "file-tree.tsx", exact: true }).first()
  await expect(file).toBeVisible()
  await file.click()

  const tab = page.getByRole("tab", { name: "file-tree.tsx" })
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")

  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  await expect(viewer).toBeVisible()
  await expect(viewer).toContainText("export default function FileTree")
})
