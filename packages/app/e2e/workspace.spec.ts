import { test, expect, type Page } from "@playwright/test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const tempDirs: string[] = []

async function createTestDirectory(name: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `opencode-workspace-${name}-`))
  tempDirs.push(dir)
  return dir
}

async function selectCommand(page: Page, commandName: string) {
  const isMac = await page.evaluate(() => navigator.platform.startsWith("Mac"))
  const mod = isMac ? "Meta" : "Control"
  await page.keyboard.press(`${mod}+Shift+P`)
  const dialog = page.locator('[role="dialog"]')
  await expect(dialog).toBeVisible({ timeout: 5000 })
  await dialog.locator("input").first().fill(commandName)
  await expect(dialog).toContainText(commandName)
  await page.keyboard.press("Enter")
}

async function addFolderFromDialog(page: Page, folderPath: string) {
  await page.getByRole("button", { name: "Add Folder" }).click()
  await expect(page.getByRole("heading", { name: "Add Folder" })).toBeVisible()
  const input = page.locator('[role="dialog"] input').first()
  await input.fill(folderPath)
  await expect(input).toHaveValue(folderPath)
  await page.keyboard.press("Enter")
}

test.describe("Multi-Root Workspaces", () => {
  test.afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Recent projects")).toBeVisible({ timeout: 10000 })
  })

  test("create workspace with multiple folders", async ({ page }) => {
    const firstFolder = await createTestDirectory("first")
    const secondFolder = await createTestDirectory("second")
    const workspaceName = `E2E Test Workspace ${Date.now()}`

    await selectCommand(page, "Create Workspace")

    await expect(page.getByRole("heading", { name: "Create Workspace" })).toBeVisible()
    await page.getByPlaceholder("My workspace").fill(workspaceName)

    const createButton = page.getByRole("button", { name: "Create Workspace" })
    await expect(createButton).toBeDisabled()

    await addFolderFromDialog(page, firstFolder)
    await expect(page.getByRole("heading", { name: "Create Workspace" })).toBeVisible()
    await expect(page.getByText(firstFolder)).toBeVisible()
    await expect(createButton).toBeEnabled()

    await addFolderFromDialog(page, secondFolder)
    await expect(page.getByRole("heading", { name: "Create Workspace" })).toBeVisible()
    await expect(page.getByText(secondFolder)).toBeVisible()

    await createButton.click()
    await expect(page.getByRole("heading", { name: "Create Workspace" })).not.toBeVisible()

    await selectCommand(page, "Open Workspace")
    await expect(page.getByRole("heading", { name: "Open Workspace" })).toBeVisible()
    await expect(page.locator('[role="dialog"]')).toContainText(workspaceName)
  })

  test("open workspace dialog", async ({ page }) => {
    await selectCommand(page, "Open Workspace")

    await expect(page.getByRole("heading", { name: "Open Workspace" })).toBeVisible()
    await expect(page.locator('[role="dialog"]')).toContainText("Open Workspace")
  })

  test("add and remove folders in workspace creation", async ({ page }) => {
    const folder = await createTestDirectory("remove")

    await selectCommand(page, "Create Workspace")

    await addFolderFromDialog(page, folder)
    await expect(page.getByRole("heading", { name: "Create Workspace" })).toBeVisible()
    await expect(page.getByText(folder)).toBeVisible()

    await page.getByRole("button", { name: "Remove folder" }).first().click()
    await expect(page.getByText("No folders added yet")).toBeVisible()

    const createButton = page.getByRole("button", { name: "Create Workspace" })
    await expect(createButton).toBeDisabled()
  })
})
