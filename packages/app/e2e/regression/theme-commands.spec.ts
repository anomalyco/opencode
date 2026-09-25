import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "/workspace/theme-commands"
const sessionID = "ses_theme_commands"

test.use({ colorScheme: "light" })

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    directory,
    project: { id: "project_theme", worktree: directory, time: { created: 1, updated: 1 }, sandboxes: [] },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "theme-commands",
        projectID: "project_theme",
        directory,
        title: "Theme commands",
        version: "dev",
        time: { created: 1, updated: 1 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((directory) => {
    if (!localStorage.getItem("settings.v3"))
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
    if (!localStorage.getItem("opencode.global.dat:server"))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
    if (!localStorage.getItem("opencode-theme-id")) localStorage.setItem("opencode-theme-id", "oc-2")
    if (!localStorage.getItem("opencode-color-scheme")) localStorage.setItem("opencode-color-scheme", "dark")
  }, directory)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
})

test("previews, cancels and saves themes and color schemes in the new layout", async ({ page }) => {
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))
  const root = page.locator("html")
  const dialog = page.getByRole("dialog")
  const search = dialog.getByRole("textbox")

  for (const entry of [
    { title: "Use theme: Dracula", attribute: "data-theme", before: "oc-2", after: "dracula" },
    { title: "Use color scheme: Light", attribute: "data-color-scheme", before: "dark", after: "light" },
  ]) {
    await expect(root).toHaveAttribute(entry.attribute, entry.before)
    await page.keyboard.press(`${modifier}+p`)
    await search.fill(entry.title)
    await expect(dialog.getByRole("option", { name: entry.title, exact: true })).toHaveCount(1)
    await expect(root).toHaveAttribute(entry.attribute, entry.after)
    await search.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(root).toHaveAttribute(entry.attribute, entry.before)
    await page.reload()
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
    await expect(root).toHaveAttribute(entry.attribute, entry.before)

    await page.keyboard.press(`${modifier}+k`)
    await search.fill(entry.title)
    await expect(root).toHaveAttribute(entry.attribute, entry.after)
    await search.press("Enter")
    await expect(dialog).toBeHidden()
    await page.reload()
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
    await expect(root).toHaveAttribute(entry.attribute, entry.after)
  }
})

test("preserves session shortcuts while exposing theme cycling", async ({ page }) => {
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))
  const root = page.locator("html")
  await expect(root).toHaveAttribute("data-theme", "oc-2")
  await page.keyboard.press(`${modifier}+w`)
  await expect(page).toHaveURL(/\/$/)
  await page.keyboard.press(`${modifier}+Shift+t`)
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await expect(root).toHaveAttribute("data-theme", "oc-2")

  await page.keyboard.press(`${modifier}+Shift+s`)
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await expect(root).toHaveAttribute("data-color-scheme", "dark")

  await page.keyboard.press(`${modifier}+k`)
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox").fill("Cycle color scheme")
  await dialog.getByRole("option", { name: "Cycle color scheme", exact: true }).click()
  await expect(root).toHaveAttribute("data-color-scheme", "light")
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()

  await page.keyboard.press(`${modifier}+k`)
  await dialog.getByRole("textbox").fill("Cycle theme")
  await dialog.getByRole("option", { name: "Cycle theme", exact: true }).click()
  await expect(root).toHaveAttribute("data-theme", "one-dark")
})

test("keeps theme commands available from home to an existing session", async ({ page }) => {
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))
  const dialog = page.getByRole("dialog")
  const session = page.locator('[data-component="home-session-row"]').filter({ hasText: "Theme commands" })

  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(session).toBeVisible()
  await page.keyboard.press(`${modifier}+k`)
  await dialog.getByRole("textbox").fill("theme")
  await expect(dialog.getByRole("option", { name: "Use theme: Dracula", exact: true })).toHaveCount(1)
  await dialog.getByRole("option", { name: "Use theme: Dracula", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula")
  await page.reload()
  await expect(session).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula")

  await session.click()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await page.keyboard.press(`${modifier}+p`)
  await dialog.getByRole("textbox").fill("theme")
  await expect(dialog.getByRole("option", { name: "Use theme: Dracula", exact: true })).toHaveCount(1)
  await dialog.getByRole("textbox").fill("color scheme")
  for (const scheme of ["System", "Light", "Dark"]) {
    await expect(dialog.getByRole("option", { name: `Use color scheme: ${scheme}`, exact: true })).toHaveCount(1)
  }
})

test("follows system color scheme changes after saving the system option", async ({ page }) => {
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))
  const root = page.locator("html")
  await page.keyboard.press(`${modifier}+p`)
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox").fill("Use color scheme: System")
  await dialog.getByRole("option", { name: "Use color scheme: System", exact: true }).click()
  await expect(root).toHaveAttribute("data-color-scheme", "light")
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(root).toHaveAttribute("data-color-scheme", "dark")
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await expect(root).toHaveAttribute("data-color-scheme", "dark")
  await page.emulateMedia({ colorScheme: "light" })
  await expect(root).toHaveAttribute("data-color-scheme", "light")
})

test("preserves theme selection and the theme shortcut in the legacy layout", async ({ page }) => {
  // The old layout is only available before its retirement date.
  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00Z"))
  await page.evaluate(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: false } }))
  })
  await page.reload()
  await expect(page.getByRole("textbox", { name: /^Ask anything/ })).toBeEditable()
  await expect(page.locator("body")).not.toHaveAttribute("data-new-layout")

  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))
  await page.keyboard.press(`${modifier}+p`)
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox").fill("Use theme: Dracula")
  await dialog.getByRole("button", { name: "Use theme: Dracula", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula")
  await page.reload()
  await expect(page.getByRole("textbox", { name: /^Ask anything/ })).toBeEditable()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula")
  await page.keyboard.press(`${modifier}+Shift+t`)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "everforest")
})
