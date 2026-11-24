import type { Page } from "@hona/strobe"
import type { Page as PlaywrightPage } from "@playwright/test"

const KEY = "perf.start-storage"

/**
 * Every later document starts from the local storage that `saveStartStorage` recorded. The app writes its layout (the
 * review pane open, its tab) on pagehide, so without this a reset's reload would carry what the run opened into the
 * next run.
 */
export async function keepStartStorage(page: Pick<PlaywrightPage, "addInitScript">) {
  await page.addInitScript((key) => {
    const saved = sessionStorage.getItem(key)

    if (saved === null) return

    localStorage.clear()

    // SAFETY: only saveStartStorage writes this key, as an object of localStorage's own strings.
    const entries = Object.entries(JSON.parse(saved) as Record<string, string>)

    for (const [name, value] of entries) localStorage.setItem(name, value)
  }, KEY)
}

/** Records the local storage runs start from: call last in `setup`, once the page has loaded. */
export function saveStartStorage(page: Page) {
  return page.eval((key) => sessionStorage.setItem(key, JSON.stringify({ ...localStorage })), KEY)
}
