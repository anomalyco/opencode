import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/OpenSessionDeepLinkTest"
const projectID = "proj_open_session_deep_link"
const sessionID = "ses_open_session_deep_link"
const title = "Open Session Deep Link Test"

function session() {
  return {
    id: sessionID,
    slug: "open-session-deep-link",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "open-session-deep-link-test",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: {
          "claude-sonnet-4-5": {
            id: "claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            limit: { context: 200_000 },
          },
        },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-sonnet-4-5" },
  }
}

test.describe("regression: open-session deep link", () => {
  test("navigates to the correct session when a valid open-session deep link is dispatched", async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: project(),
      provider: provider(),
      sessions: [session()],
      pageMessages: () => ({ items: [] }),
    })

    await page.goto("/")

    await page.evaluate((urls: string[]) => {
      window.dispatchEvent(new CustomEvent("opencode:deep-link", { detail: { urls } }))
    }, [`opencode://open-session/${sessionID}`])

    await expect(page).toHaveURL(`/${base64Encode(directory)}/session/${sessionID}`, { timeout: 10_000 })
  })

  test("shows error toast and keeps current URL when open-session deep link points to a missing session", async ({
    page,
  }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: project(),
      provider: provider(),
      sessions: [],
      pageMessages: () => ({ items: [] }),
    })

    await page.goto("/")
    const initialURL = page.url()

    await page.evaluate((urls: string[]) => {
      window.dispatchEvent(new CustomEvent("opencode:deep-link", { detail: { urls } }))
    }, ["opencode://open-session/ses_notfound_xxxxxx"])

    // A toast should appear with the error message
    await expect(page.getByText("Session not found")).toBeVisible({ timeout: 5_000 })

    // URL must not have navigated to a session page
    expect(page.url()).toBe(initialURL)
  })
})
