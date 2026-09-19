import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const sessionID = "ses_untitled_header_regression"

test("keeps the header visible for a persisted untitled session", async ({ page }) => {
  await mockOpenCodeServer(page, {
    sessions: [{ ...fixture.sessions[0], id: sessionID, title: "" }],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(fixture.directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt" }))
  const header = page.locator("[data-session-title]")
  await expect(header).toBeVisible()
  await expect(header.getByRole("button", { name: "More options" })).toBeVisible()

  await page.goto(`/${base64Encode(fixture.directory)}/session`)
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt" }))
  await expect(page.locator("[data-session-title]")).toHaveCount(0)
})
