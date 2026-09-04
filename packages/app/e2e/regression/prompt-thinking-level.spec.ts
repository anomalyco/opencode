import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptThinkingLevelRegression"
const projectID = "proj_prompt_thinking_level_regression"
const sessionID = "ses_prompt_thinking_level_regression"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("shows thinking on hover or a non-default selection while preserving keyboard access", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-thinking-level-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "thinking-model": {
              id: "thinking-model",
              name: "Thinking Model",
              limit: { context: 200_000 },
              variants: { high: {} },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "thinking-model" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-thinking-level-regression",
        projectID,
        directory,
        title: "Prompt thinking level regression",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  const composer = page.locator('[data-component="composer"]')
  const input = composer.getByRole("textbox", { name: "Prompt", exact: true })
  const control = composer.getByRole("button", { name: "Choose model variant" })
  await expectAppVisible(composer)

  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")
  await expect(control).toHaveCSS("pointer-events", "none")

  await input.hover()
  await expect(control).toHaveCSS("opacity", "1")
  await input.click()
  await page.mouse.move(0, 0)
  await expect(input).toBeFocused()
  await expect(control).toHaveCSS("opacity", "0")

  await input.hover()
  await control.click()
  const high = page.getByRole("menuitemradio", { name: "high" })
  await expect(high).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toHaveAttribute("aria-expanded", "true")
  await expect(control).toHaveCSS("opacity", "1")
  await expect(high).toBeVisible()
  await high.click()

  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("high")
  await expect(control).toHaveCSS("opacity", "1")

  await control.click()
  await page.getByRole("menuitemradio", { name: "default", exact: true }).click()
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")

  // The single-agent fixture has only Add and Model before the thinking trigger.
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Add images and files" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Thinking Model" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitemradio", { name: "default", exact: true })).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Escape")
  await expect(control).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toHaveCSS("opacity", "0")
})
