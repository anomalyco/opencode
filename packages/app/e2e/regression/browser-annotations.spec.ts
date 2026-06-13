import { expect, test } from "@playwright/test"
import { base64Encode, checksum } from "@cedric/core/util/encode"
import { pathKey } from "../../src/utils/path-key"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/BrowserAnnotationRegression"
const projectID = "proj_browser_annotation_regression"
const sessionID = "ses_browser_annotation_regression"

test("persists browser annotations and hands them to Side Chat", async ({ page }) => {
  const annotation = {
    id: "annotation-regression",
    type: "note",
    url: "https://example.com/docs",
    title: "Annotated Example",
    text: "Relevant pricing table",
    note: "Confirm enterprise limits",
    createdAt: 1_700_000_000_000,
  }

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "browser-annotation-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "chat-model": {
              id: "chat-model",
              name: "Chat Model",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "chat-model" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "browser-annotation-regression",
        projectID,
        directory,
        title: "Browser annotation regression",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })

  await page.addInitScript(
    (input) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        input.storageKey,
        JSON.stringify({
          tabs: [
            {
              id: "browser-annotation-regression",
              type: "browser",
              title: "Annotated Example",
              state: {
                url: "https://example.com/docs",
                annotations: [
                  input.annotation,
                  {
                    ...input.annotation,
                    id: "annotation-other-page",
                    url: "https://example.com/other",
                  },
                ],
              },
              isActive: true,
            },
          ],
          activeTabId: "browser-annotation-regression",
        }),
      )
    },
    {
      annotation,
      storageKey: `${workspaceStorage(pathKey(directory))}:workspace:workspace-tabs`,
    },
  )

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("button", { name: "Show browser annotations" }))

  await page.getByRole("button", { name: "Show browser annotations" }).click()
  await expect(page.getByText("1 on this page")).toBeVisible()
  await expect(page.getByText("Relevant pricing table")).toBeVisible()
  await expect(page.getByText("Confirm enterprise limits")).toBeVisible()

  await page.getByRole("button", { name: "Send page to Side Chat" }).click()
  await expect(page.getByPlaceholder("Ask in side chat...")).toBeVisible()
  await expect(page.getByText(/Annotated Example\s+·\s+1 annotations/)).toBeVisible()
})

function workspaceStorage(dir: string) {
  return `opencode.workspace.${(dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")}.${checksum(dir) ?? "0"}.dat`
}
