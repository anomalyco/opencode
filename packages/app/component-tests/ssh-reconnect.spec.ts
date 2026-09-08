import { expect, story } from "../../storybook/playwright/story"

story("settings menu reconnect retains its prompt handler across server updates", async ({ mount, page }) => {
  const component = await mount("app-dialog-ssh--settings-reconnect")
  await component.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Connect", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("textbox")).toBeVisible()
  await dialog.getByRole("textbox").fill("fixture-password")
  await dialog.getByRole("button", { name: "Continue" }).click()
  await expect(dialog.getByRole("textbox", { name: "Verification code:" })).toBeVisible()
  await dialog.getByRole("textbox").fill("123456")
  await dialog.getByRole("button", { name: "Continue" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(component.getByRole("button", { name: "Authenticate", exact: true })).toHaveCount(0)
})

story("cancelling a version mismatch permits reconnecting again", async ({ mount, page }) => {
  const component = await mount("app-dialog-ssh--incompatible-session")
  await component.getByRole("button", { name: "Reconnect", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("alert")).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await component.getByRole("button", { name: "Reconnect", exact: true }).click()
  await expect(dialog.getByRole("alert")).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
