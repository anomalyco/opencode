import { test, expect } from "./fixtures"

test("file tree can expand folders and open a file", async ({ page, gotoSession }) => {
  await gotoSession()

  const toggle = page.getByRole("button", { name: "Toggle file tree" })
  const treeTabs = page.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')

  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(treeTabs).toBeVisible()

  await treeTabs.locator('[data-slot="tabs-trigger"]').nth(1).click()

  const node = (name: string) => treeTabs.getByRole("button", { name, exact: true })

  await expect(node("packages")).toBeVisible()
  await node("packages").click()

  await expect(node("app")).toBeVisible()
  await node("app").click()

  await expect(node("src")).toBeVisible()
  await node("src").click()

  await expect(node("components")).toBeVisible()
  await node("components").click()

  await expect(node("file-tree.tsx")).toBeVisible()
  await node("file-tree.tsx").click()

  const tab = page.getByRole("tab", { name: "file-tree.tsx" })
  await expect(tab).toBeVisible()
  await tab.click()

  const code = page.locator('[data-component="code"]').first()
  await expect(code.getByText("export default function FileTree")).toBeVisible()
})
