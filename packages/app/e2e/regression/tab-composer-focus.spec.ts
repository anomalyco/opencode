import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const directory = "/tab-focus"
const sessions = ["Alpha", "Beta"].map((title, index) => ({
  id: `ses_tab_focus_${index}`,
  slug: `tab-focus-${index}`,
  projectID: "proj_tab_focus",
  directory,
  title,
  version: "dev",
  time: { created: 1700000000000 + index, updated: 1700000000000 + index },
}))

for (const { layout, platform, modifier } of [
  { layout: "horizontal", platform: "MacIntel", modifier: "Meta" },
  { layout: "vertical", platform: "MacIntel", modifier: "Meta" },
  { layout: "horizontal", platform: "Linux x86_64", modifier: "Control" },
  { layout: "vertical", platform: "Linux x86_64", modifier: "Control" },
]) {
  test(`${modifier}+number refocuses the destination composer with ${layout} tabs`, async ({ page }, testInfo) => {
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: "proj_tab_focus",
        worktree: directory,
        vcs: "git",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: {
        all: [{ id: "opencode", name: "OpenCode", models: { test: { id: "test", name: "Test" } } }],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "test" },
      },
      sessions,
      pageMessages: () => ({ items: [] }),
    })
    await page.addInitScript(
      ({ server, sessions, layout, platform }) => {
        Object.defineProperty(navigator, "platform", { configurable: true, value: platform })
        localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: layout } }))
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify(sessions.map((session) => ({ type: "session", server, sessionId: session.id }))),
        )
      },
      { server, sessions, layout, platform },
    )
    const href = (index: number) => `/server/${base64Encode(server)}/session/${sessions[index].id}`
    await page.goto(href(0))
    await expect(page.locator("[data-titlebar-tab-title]")).toHaveText(["Alpha", "Beta"])
    const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(editor).toBeEditable()
    await editor.fill("Alpha draft")

    await page.keyboard.press("Home")
    for (const { index, text, expected } of [
      { index: 1, text: "Beta draft", expected: "Beta draft" },
      { index: 0, text: "Edited ", expected: "Edited Alpha draft" },
      { index: 1, text: " continued", expected: "Beta draft continued" },
    ]) {
      await page.keyboard.press(`${modifier}+${index + 1}`)
      await expect(page).toHaveURL(href(index))
      await expect(page.getByRole("heading", { name: sessions[index].title, exact: true })).toBeVisible()
      await expect(editor).toBeEditable()
      await expect(editor).toBeFocused()
      await page.keyboard.type(text)
      await expect(editor).toHaveText(expected)
    }
    await page.setViewportSize({ width: 800, height: 720 })
    await page.keyboard.press(`${modifier}+1`)
    await expect(page).toHaveURL(href(0))
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("Edited Alpha draft")
    const longDraft = "Keep this long draft while switching tabs. ".repeat(100)
    await editor.fill(longDraft)
    await page.keyboard.press(`${modifier}+2`)
    await expect(page).toHaveURL(href(1))
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("Beta draft continued")
    await page.keyboard.press(`${modifier}+1`)
    await expect(page).toHaveURL(href(0))
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText(longDraft)
    await testInfo.attach("refocused-composer", { body: await page.screenshot(), contentType: "image/png" })
  })
}
