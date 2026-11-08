import type { Locator, Page } from "@playwright/test"
import { base64Encode } from "@opencode/util/encode"

/** Opens the side panel's "Open file" launcher tab from the new tab view the strip's + opens. */
export async function openFileLauncher(panel: Locator) {
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await panel.getByRole("button", { name: /^Open file/ }).click()
}

/** Opens the file browser with its shortcut: it reuses the selected launcher, else opens another. */
export async function browseFiles(page: Page) {
  await page.keyboard.press("Control+Alt+P")
}

/** Opens the Review tab from the launcher an empty side panel lists. */
export async function openReviewLauncher(panel: Locator) {
  await panel.getByRole("button", { name: /^Review/ }).click()
}

/** Storage that restores the Review tab, selected, in each session's side strip, as the app writes it. */
export function reviewTabs(directory: string, ...sessions: string[]) {
  return {
    "opencode.global.dat:layout": {
      sessionTabs: Object.fromEntries(
        sessions.map((id) => [
          `local\u0000${base64Encode(directory)}/${id}`,
          { all: ["review:changes"], active: "review:changes" },
        ]),
      ),
    },
  }
}
