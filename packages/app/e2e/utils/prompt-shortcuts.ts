import { expect, type Page } from "@playwright/test"

export async function promptShortcuts(page: Page) {
  const settings = page.getByTestId("settings-screen")
  const binding = (id: string) => settings.locator(`[data-keybind-id="prompt.${id}"]`)
  const modifier = await page.evaluate(() => (/Mac|iPod|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control"))

  await page.keyboard.press(`${modifier}+,`)
  await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Keyboard shortcuts", exact: true })).toBeVisible()

  return {
    settings,
    binding,
    record: async (id: string, keys: string, label: string | RegExp) => {
      await binding(id).click()
      await expect(binding(id)).toHaveText("Press keys")
      await page.keyboard.press(keys)
      await expect(binding(id)).toHaveText(label)
    },
    close: () => settings.getByRole("button", { name: "Back to app", exact: true }).click(),
  }
}
