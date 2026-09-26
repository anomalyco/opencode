import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

for (const confirm of [false, true]) {
  test(`connection link ${confirm ? "opens the exact project" : "can be cancelled without changing choices"}`, async ({
    page,
  }, info) => {
    const url = `http://localhost:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
    const directory = "/opencode-demo/canonical"
    const link = `opencode://connect?${new URLSearchParams({ url, directory })}`
    const requests: string[] = []
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("request", (request) => {
      if (request.url().startsWith(url)) requests.push(request.url())
    })
    await mockOpenCodeServer(page, {
      sessions: [],
      provider: fixture.provider,
      directory,
      project: { ...fixture.project, worktree: "/opencode-demo/worktree", sandboxes: [directory] },
      pageMessages,
      fileList: () => [],
      findFiles: () => [],
    })
    if (confirm) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript((link) => {
        Object.assign(window, { __OPENCODE__: { deepLinks: [link] } })
      }, link)
    }
    await page.goto("/")
    if (!confirm) await expectAppVisible(page.getByRole("button", { name: "Add project" }).first())
    const before = await page.evaluate(() => localStorage.getItem("opencode.global.dat:server"))
    if (!confirm) {
      await page.evaluate((link) => {
        window.dispatchEvent(new CustomEvent("opencode:deep-link", { detail: { urls: [link] } }))
      }, link)
    }
    const dialog = page.getByRole("dialog", { name: "Open project" })
    await expect(dialog).toContainText(url)
    await expect(dialog).toContainText(directory)
    expect(requests).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath("connection-confirmation.png"), fullPage: false })
    await dialog.getByRole("button", { name: confirm ? "Open project" : "Cancel", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    if (!confirm) {
      expect(await page.evaluate(() => localStorage.getItem("opencode.global.dat:server"))).toBe(before)
      expect(requests).toEqual([])
    } else {
      await expect(page).toHaveURL(/\/new-session\?draftId=/)
      await expect
        .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opencode.window.browser.dat:tabs") ?? "[]")))
        .toEqual([expect.objectContaining({ type: "draft", server: url, directory })])
    }
    expect(errors).toEqual([])
  })
}
