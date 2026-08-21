import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/ComposerEditing"
const projectID = "proj_composer_editing"
const sessionID = "ses_composer_editing"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("preserves the draft when a populated command menu triggers a built-in", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "composer-editing",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "composer-editing",
        projectID,
        directory,
        title: "Composer editing",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  const composer = page.locator('[data-component="composer"]')
  const input = composer.locator('[data-component="composer-editor"]')
  await expect
    .poll(() => input.evaluate((element) => getComputedStyle(element, "::before").content))
    .toBe(`"${String.fromCodePoint(0x200b)}"`)
  await expectAppVisible(composer)

  await input.fill("keep me")
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Commands" }).click()
  await page.locator('[data-suggestion-id="model.choose"]').click()

  await expect(input).toHaveText("keep me")
})
