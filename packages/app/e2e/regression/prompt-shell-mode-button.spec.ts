import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptShellModeButtonRegression"
const projectID = "proj_prompt_shell_mode_button_regression"
const sessionID = "ses_prompt_shell_mode_button_regression"

const baseConfig = {
  directory,
  project: {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "prompt-shell-mode-button-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  },
  provider: {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            limit: { context: 200_000 },
            variants: {},
          },
        },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "test-model" },
  },
  sessions: [
    {
      id: sessionID,
      slug: "prompt-shell-mode-button-regression",
      projectID,
      directory,
      title: "Prompt shell mode button regression",
      version: "dev",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
  ],
  pageMessages: () => ({ items: [] }),
}

test.describe("regression: shell mode toggle button in v2 composer", () => {
  test.beforeEach(async ({ page }) => {
    await mockOpenCodeServer(page, baseConfig)
    await page.addInitScript(() => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    })
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectAppVisible(page.locator('[data-component="session-composer"]'))
  })

  test("shell mode button is visible in v2 composer toolbar", async ({ page }) => {
    const button = page.locator('[data-action="prompt-shell-mode"]')
    await expect(button).toBeVisible()
  })

  test("shell mode button enters shell mode on click", async ({ page }) => {
    const button = page.locator('[data-action="prompt-shell-mode"]')
    const input = page.locator('[data-component="prompt-input"]')

    await button.click()

    // aria-pressed reflects active shell mode
    await expect(button).toHaveAttribute("aria-pressed", "true")
    // input switches to monospace font in shell mode (font-mono! class)
    await expect(input).toHaveClass(/font-mono/)
  })

  test("shell mode button exits shell mode on second click", async ({ page }) => {
    const button = page.locator('[data-action="prompt-shell-mode"]')
    const input = page.locator('[data-component="prompt-input"]')

    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")

    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "false")
    await expect(input).not.toHaveClass(/font-mono/)
  })

  test("Escape exits shell mode entered via button", async ({ page }) => {
    const button = page.locator('[data-action="prompt-shell-mode"]')
    const input = page.locator('[data-component="prompt-input"]')

    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")

    await input.focus()
    await page.keyboard.press("Escape")
    await expect(button).toHaveAttribute("aria-pressed", "false")
  })

  test("! shortcut still enters shell mode and button reflects state", async ({ page }) => {
    const button = page.locator('[data-action="prompt-shell-mode"]')
    const input = page.locator('[data-component="prompt-input"]')

    await input.focus()
    await page.keyboard.press("!")
    await expect(button).toHaveAttribute("aria-pressed", "true")
  })
})
