import { expect, test } from "../../lab/playwright/test"

test("the connect screen can retry a failed health check after scanning a one-time QR code", async ({ mount }) => {
  const component = await mount("app-connect-to-server--retry-after-scan")
  await component.getByRole("button", { name: "Read fixture QR code" }).click()
  await expect(component.getByRole("alert")).toHaveText(
    "Could not connect. Check the server address and password, then try again.",
  )
  await expect(component.getByLabel("Pairing link", { exact: true })).toHaveValue(
    "https://build.example.test/auth/connect/example",
  )

  await component.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(component.getByRole("status")).toHaveText("Connected to https://build.example.test in this preview.")
})

test("a Keep screen active read that fails offers Try again and keeps the switch enabled", async ({ mount, page }) => {
  // The page reads three more times, 1, 2 and 4 seconds apart, before it shows the failure.
  await page.clock.install()
  const component = await mount("plugins-pairing--screen-setting-fails")
  const toggle = component.getByRole("switch", { name: "Keep screen active", exact: true })
  const error = component.getByRole("alert").filter({ hasText: "Could not update the screen activity setting." })
  const retry = component.getByRole("button", { name: "Try again", exact: true })

  await expect(toggle).toBeDisabled()
  await page.clock.runFor(8_000)
  await expect(error).toBeVisible()
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()

  await retry.click()
  await expect(error).toHaveCount(0)
  await expect(retry).toHaveCount(0)
  await expect(toggle).toBeEnabled()

  await toggle.focus()
  await toggle.press("Space")
  await expect(toggle).toBeChecked()
  await expect(toggle).toBeEnabled()
})
