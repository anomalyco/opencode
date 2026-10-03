import { expect, type Page } from "@playwright/test"
import { SERVER } from "./app"

export async function openWithDirection(page: Page, route: string, direction: "ltr" | "rtl") {
  await page.goto(`/e2e/utils/app-direction.html?${new URLSearchParams({ server: SERVER, route, direction })}`)
}

/**
 * Opens the app at a route as the desktop shell starts it: the window's extensions run at once, and the app interface
 * mounts over the preloaded route only when `start` runs, as it does once the desktop's server is up.
 */
export async function openHeldStart(page: Page, route: string) {
  await page.goto(
    `/e2e/utils/app-direction.html?${new URLSearchParams({ server: SERVER, route, direction: "ltr", held: "" })}`,
  )
  const start = page.getByRole("button", { name: "Start app", exact: true, includeHidden: true })
  await expect(start).toBeVisible()

  return {
    // A modal open meanwhile hides the page outside it, so the button is found and clicked past the modal.
    start: () => start.dispatchEvent("click"),
  }
}
