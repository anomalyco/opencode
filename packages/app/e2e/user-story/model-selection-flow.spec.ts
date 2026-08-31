import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/NewProject"

test("creates a session in a new project and selects its model", async ({ page }) => {
  // An empty draft must remain usable when the file viewer is unavailable.
  await page.route(/(?:\/_assets\/file-(?!icon-)[^/]+\.js|\/session-ui\/src\/components\/file\.tsx)(?:\?|$)/, (route) =>
    route.abort(),
  )
  await mockOpenCodeServer(page, {
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
          id: "opencode",
          name: "OpenCode",
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
          id: "opencode-go",
          name: "OpenCode Go",
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
      connected: ["opencode", "opencode-go"],
      default: { providerID: "opencode", modelID: "free-model" },
    }),
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
    localStorage.setItem(
      "opencode.global.dat:model",
      JSON.stringify({
        user: [
          { providerID: "opencode", modelID: "free-model", visibility: "show" },
          { providerID: "opencode-go", modelID: "go-model-1", visibility: "show" },
        ],
        recent: [{ providerID: "opencode-go", modelID: "go-model-1" }],
        variant: {},
      }),
    )
  })

  await page.goto("/")
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  const directoryItem = page.getByRole("treeitem", { name: "NewProject" })
  await expect(directoryItem).toBeVisible()
  await directoryItem.click()
  const selectFolder = page.getByRole("button", { name: "Select folder" })
  await expect(selectFolder).toBeEnabled()
  await selectFolder.click()

  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="composer"]'))

  const modelControl = page.locator('[data-action="composer-model"]')
  await expect(modelControl).toContainText("Go Model 1")
  await modelControl.click()
  await page.locator('[data-option-key="opencode:free-model"]').click()
  await expect(modelControl).toContainText("Free Model")

  await modelControl.click()
  const goModel = page.locator('[data-option-key="opencode-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.click()

  await expect(modelControl).toContainText("Go Model 1")
})

test("restores each existing session's model and variant when switching tabs", async ({ page }) => {
  const sessions = ["A", "B"].map((name) => ({
    ...fixture.sessions[0],
    id: `ses_model_${name}`,
    title: `Model ${name}`,
    model: { id: `model-${name}`, providerID: "opencode", variant: "balanced" },
  }))
  await mockOpenCodeServer(page, {
    ...fixture,
    sessions,
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: Object.fromEntries(
            sessions.map((session) => [
              session.model.id,
              {
                id: session.model.id,
                name: session.title,
                limit: { context: 200_000 },
                variants: { balanced: {}, high: {} },
              },
            ]),
          ),
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: sessions[0]!.model.id },
    },
    pageMessages: () => ({ items: [] }),
  })
  await installStressSessionTabs(page, { sessionIDs: sessions.map((session) => session.id) })

  const hrefA = stressSessionHref(sessions[0]!.id)
  const hrefB = stressSessionHref(sessions[1]!.id)
  await page.goto(hrefA)
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

  await page.locator(`[data-titlebar-tab-link][href="${hrefA}"]`).click()
  await expect(page).toHaveURL(hrefA)
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("high")
})
