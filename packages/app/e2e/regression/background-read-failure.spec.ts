import type { OpenCodeEvent } from "@opencode/client/promise"
import { expect, test } from "@playwright/test"
import { openCommandPalette, paletteSession } from "../utils/command-palette"

test.use({ serviceWorkers: "block" })

test("failed event-driven reads report an error and recover without an unhandled rejection", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const palette = await openCommandPalette(page)
  const path = `**/api/session/${paletteSession.id}`
  await page.route(path, (route) => route.abort("failed"))
  const requested = page.waitForRequest(path)
  await palette.push([
    {
      id: "evt_failed_refresh",
      created: 2,
      type: "session.viewed",
      durable: { aggregateID: paletteSession.id, seq: 1, version: 1 },
      data: { sessionID: paletteSession.id, idle: 2 },
    } as OpenCodeEvent,
  ])
  await requested
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await palette.input.fill("copy session")
  await expect(palette.dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await palette.input.press("Escape")
  await page.unroute(path)
  await palette.push([
    {
      id: "evt_recovered_refresh",
      created: 3,
      type: "session.renamed",
      durable: { aggregateID: paletteSession.id, seq: 2, version: 1 },
      data: { sessionID: paletteSession.id, title: "Recovered session" },
    } as OpenCodeEvent,
  ])
  await expect(page.getByRole("heading", { name: "Recovered session", exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
