import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"

describe("file tree", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("file tree can expand folders and open a file", async () => {
    await app.gotoSession()
    const { page } = app

    const toggle = page.getByRole("button", { name: "Toggle file tree" })
    const panel = page.locator("#file-tree-panel")
    const treeTabs = panel.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')

    await toggle.waitFor({ state: "visible" })
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect.poll(async () => await toggle.getAttribute("aria-expanded"), { timeout: 10_000 }).toBe("true")
    await panel.waitFor({ state: "visible" })
    await treeTabs.waitFor({ state: "visible" })

    const allTab = treeTabs.getByRole("tab", { name: /^all files$/i })
    await allTab.waitFor({ state: "visible" })
    await allTab.click()
    await expect.poll(async () => await allTab.getAttribute("aria-selected"), { timeout: 10_000 }).toBe("true")

    const tree = treeTabs.locator('[data-slot="tabs-content"]:not([hidden])')
    await tree.waitFor({ state: "visible" })

    const expand = async (name: string) => {
      const folder = tree.getByRole("button", { name, exact: true }).first()
      await folder.waitFor({ state: "visible" })
      const exp = await folder.getAttribute("aria-expanded")
      if (exp !== "true" && exp !== "false") throw new Error("folder missing aria-expanded")
      if (exp === "false") await folder.click()
      await expect.poll(async () => await folder.getAttribute("aria-expanded"), { timeout: 15_000 }).toBe("true")
    }

    await expand("packages")
    await expand("app")
    await expand("src")
    await expand("components")

    const file = tree.getByRole("button", { name: "file-tree.tsx", exact: true }).first()
    await file.waitFor({ state: "visible" })
    await file.click()

    const tab = page.getByRole("tab", { name: "file-tree.tsx" })
    await tab.waitFor({ state: "visible" })
    await tab.click()
    await expect.poll(async () => await tab.getAttribute("aria-selected"), { timeout: 10_000 }).toBe("true")

    await toggle.click()
    await expect.poll(async () => await toggle.getAttribute("aria-expanded"), { timeout: 10_000 }).toBe("false")

    await toggle.click()
    await expect.poll(async () => await toggle.getAttribute("aria-expanded"), { timeout: 10_000 }).toBe("true")
    await expect.poll(async () => await allTab.getAttribute("aria-selected"), { timeout: 10_000 }).toBe("true")

    const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
    await viewer.waitFor({ state: "visible" })
    await expect.poll(async () => (await viewer.innerText()).includes("export default function FileTree"), {
      timeout: 15_000,
    }).toBe(true)
  })
})
