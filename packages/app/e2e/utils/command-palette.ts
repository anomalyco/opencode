import { expect, type Page } from "@playwright/test"
import { NO_PROVIDER, project, sessionHref } from "./app"
import { mockOpenCodeServer } from "./mock-server"
import { APP_READY_TIMEOUT } from "./waits"

export const paletteSession = {
  id: "ses_command_palette",
  projectID: "proj_command_palette",
  directory: "C:/OpenCode/CommandPalette",
  title: "Palette fixture session",
  time: { created: 1700000000000, updated: 1700000000000 },
}

// Production builds strip DEV-only warnings (such as duplicate command IDs), so CI cannot observe them here.
export function captureConsoleWarnings(page: Page) {
  const warnings: string[] = []
  page.on("console", (message) => {
    if (message.type() !== "warning" && message.type() !== "error") return

    // This message comes from test isolation, not application code.
    if (message.text() === "Service Worker registration blocked by Playwright") return
    warnings.push(message.text())
  })

  return warnings
}

export async function openCommandPalette(page: Page, home = false) {
  const mock = await mockOpenCodeServer(page, {
    directory: paletteSession.directory,
    project: project({ id: paletteSession.projectID, directory: paletteSession.directory, name: "command-palette" }),
    provider: NO_PROVIDER,
    sessions: [paletteSession],
    pageMessages: () => ({ items: [] }),
    findFiles: () => [],
  })

  await page.goto(home ? "/" : sessionHref(paletteSession.id))

  if (home) {
    await expect(
      page.getByRole("region", { name: "Recent sessions" }).getByRole("button", { name: /Palette fixture session/ }),
    ).toBeEnabled({ timeout: APP_READY_TIMEOUT })
  }

  if (!home) {
    await expect(page.locator('[data-component="composer-editor"]')).toBeEditable({ timeout: APP_READY_TIMEOUT })
  }

  await page.keyboard.press("ControlOrMeta+Shift+P")
  const dialog = page.getByRole("dialog")
  const input = dialog.getByRole("textbox")
  await expect(input).toBeFocused()
  await expect(dialog.getByRole("option")).not.toHaveCount(0)

  return { dialog, input, push: mock.push }
}
