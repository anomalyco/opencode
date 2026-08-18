import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Page } from "@playwright/test"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectAppVisible } from "../../utils/waits"
import { expect } from "../benchmark"

const directory = "C:/OpenCode/ComposerPasteBenchmark"
const projectID = "proj_composer_paste_benchmark"
const sessionID = "ses_composer_paste_benchmark"

// Opens a session against the mock server with the requested composer, and returns the
// selector both composers put on their editor.
export async function openComposerSession(page: Page, newLayout: boolean) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "composer-paste-benchmark",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "composer-paste-benchmark",
        projectID,
        directory,
        title: "Composer paste benchmark",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((layout) => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: layout, layoutTransitionEligible: true } }),
    )
    // A profile that has never launched the app counts as an upgrade, and the upgrade
    // migration forces the new layout on regardless of the stored preference.
    localStorage.setItem("app-version.v1", JSON.stringify({ version: "99.0.0" }))
  }, newLayout)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]').first())
  // Both composers mark their editor with the same attribute, so measuring the wrong one is
  // invisible in the results unless the V2 wrapper is checked explicitly. The layout only
  // settles once the persisted settings resolve, so this has to be a retrying assertion.
  await expect(page.locator('[data-component="prompt-input-v2"]')).toHaveCount(newLayout ? 1 : 0)
  return '[data-component="prompt-input"]'
}
