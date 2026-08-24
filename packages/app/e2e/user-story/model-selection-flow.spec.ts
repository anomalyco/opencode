import { expect, test } from "@playwright/test"
import { mockPencodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/Pencode/NewProject"

test("creates a session in a new project, connects Pencode Go, and selects its model", async ({ page }) => {
  let connectedGo = false
  let pendingGo = false
  const connections: Array<{ integrationID: string; body: unknown }> = []

  await mockPencodeServer(page, {
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
          id: "pencode",
          name: "Pencode",
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
          id: "pencode-go",
          name: "Pencode Go",
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
      connected: connectedGo ? ["pencode", "pencode-go"] : ["pencode"],
      default: { providerID: "pencode", modelID: "free-model" },
    }),
    integrationMethods: { "pencode-go": [{ type: "api", label: "API key" }] },
    onConnectKey: (input) => {
      connections.push(input)
      if (input.integrationID === "pencode-go") pendingGo = true
    },
    onInstanceDispose: () => {
      if (pendingGo) connectedGo = true
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("pencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })

  await page.goto("/")
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  await page.locator("[data-directory-path]").click()

  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))

  const modelControl = page.locator('[data-action="prompt-model"]')
  await modelControl.click()
  await expect(page.locator('[data-section="free-models"]')).toContainText("Free models provided by Pencode")

  await page.locator('[data-provider-id="pencode-go"]').click()
  await page.locator('[data-input="provider-api-key"]').fill("mock-go-api-key")
  await page.locator('[data-action="provider-connect-submit"]').click()
  await expect(page.locator('[data-component="dialog-v2"]')).toHaveCount(0)
  expect(connections).toEqual([{ integrationID: "pencode-go", body: { type: "api", key: "mock-go-api-key" } }])

  await expect(modelControl).toHaveAttribute("data-control-type", "popover")
  await modelControl.click()
  const goModel = page.locator('[data-option-key="pencode-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.click()

  await expect(modelControl).toContainText("Go Model 1")
})
