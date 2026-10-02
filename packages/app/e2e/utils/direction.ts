import type { Page } from "@playwright/test"
import { SERVER } from "./app"

export async function openWithDirection(page: Page, route: string, direction: "ltr" | "rtl") {
  await page.goto(`/e2e/utils/app-direction.html?${new URLSearchParams({ server: SERVER, route, direction })}`)
}
