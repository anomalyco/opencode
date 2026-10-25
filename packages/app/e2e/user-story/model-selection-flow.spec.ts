import { expect, test } from "@playwright/test"
import { mockBoltServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { openSession } from "../utils/workspace"

const directory = "C:/Bolt/NewProject"

test("creates a session in a new project, connects Bolt Go, and selects its model", async ({ page }) => {
  let connectedGo = false
  let pendingGo = false
  const connections: Array<{ integrationID: string; body: unknown }> = []

  await mockBoltServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "bolt",
          name: "Bolt",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "bolt-go",
          name: "Bolt Go",
          models: {
            "go-model-1": {
              id: "go-model-1",
              name: "Go Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: connectedGo ? ["bolt", "bolt-go"] : ["bolt"],
      default: { providerID: "bolt", modelID: "free-model" },
    }),
    integrationMethods: { "bolt-go": [{ type: "api", label: "API key" }] },
    onConnectKey: (input) => {
      connections.push(input)
      if (input.integrationID === "bolt-go") pendingGo = true
    },
    onInstanceDispose: () => {
      if (pendingGo) connectedGo = true
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    // Listings are requested by absolute path and returned relative to the stable Location.
    fileList: (path) => (path === "C:/OpenCode" ? [{ path: "./", type: "directory", ignored: false }] : []),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("bolt.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })

  await page.goto("/")
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })
  await expect(picker.getByRole("combobox")).toHaveValue("C:\\OpenCode\\NewProject")

  const listing = page.waitForRequest((request) => {
    const url = new URL(request.url())

    return url.pathname === "/api/fs/list" && url.searchParams.get("path") === "C:/OpenCode"
  })

  await picker.getByRole("button", { name: "Parent", exact: true }).click()
  expect(new URL((await listing).url()).searchParams.get("location[directory]")).toBe(directory)
  const directoryItem = picker.getByRole("treeitem", { name: "NewProject", exact: true })
  await expect(directoryItem).toBeVisible()
  await directoryItem.click()
  await expect(directoryItem).toHaveAttribute("aria-selected", "true")
  await expect(picker.getByText("C:\\OpenCode\\NewProject", { exact: true })).toBeVisible()
  const selectFolder = picker.getByRole("button", { name: "Select folder", exact: true })
  await expect(selectFolder).toBeEnabled()
  await selectFolder.click()
  await expect(picker).toBeHidden()

  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="composer"]'))

  const modelControl = page.locator('[data-action="composer-model"]')
  await expect(modelControl).toContainText("Go Model 1")
  await modelControl.click()
  await expect(page.locator('[data-section="free-models"]')).toContainText("Free models provided by Bolt")

  await page.locator('[data-provider-id="bolt-go"]').click()
  await page.locator('[data-input="provider-api-key"]').fill("mock-go-api-key")
  await page.locator('[data-action="provider-connect-submit"]').click()
  await expect(page.locator('[data-component="dialog-v2"]')).toHaveCount(0)
  expect(connections).toEqual([{ integrationID: "bolt-go", body: { type: "api", key: "mock-go-api-key" } }])

  await expect(modelControl).toHaveAttribute("data-control-type", "popover")
  await modelControl.click()
  const goModel = page.locator('[data-option-key="bolt-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.click()

  await expect(modelControl).toContainText("Go Model 1")
})

test("restores each existing session's model and variant when switching tabs", async ({ page }) => {
  const sessions = ["A", "B"].map((name) => ({
    id: `ses_model_${name}`,
    title: `Model ${name}`,
    model: { id: `model-${name}`, providerID: "opencode", variant: "balanced" },
  }))

  await openSession(page, {
    name: "ModelSelection",
    sessions,
    provider: provider(
      ...sessions.map((session) => ({
        id: session.model.id,
        name: session.title,
        variants: { balanced: {}, high: {} },
      })),
    ),
  })

  const hrefA = sessionHref(sessions[0]!.id)
  const hrefB = sessionHref(sessions[1]!.id)
  const composer = page.locator('[data-component="composer"]')
  const modelControl = composer.locator('[data-action="composer-model"]')
  const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("balanced")
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toHaveText("high")

  await page.locator(`[data-titlebar-tab-link][href="${hrefB}"]`).click()
  await expect(page).toHaveURL(hrefB)
  await expect(modelControl).toHaveText("Model B")
  await expect(variant).toHaveText("balanced")
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toHaveText("high")

  // A new draft starts from the current session's non-default model and chosen variant.
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(modelControl).toHaveText("Model B")
  await expect(variant).toHaveText("high")

  await page.locator(`[data-titlebar-tab-link][href="${hrefA}"]`).click()
  await expect(page).toHaveURL(hrefA)
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("high")
})
