import { expect, test, type Route } from "@playwright/test"

const server = "http://127.0.0.1:4097"

test("server dialog keeps focus above fullscreen settings", async ({ page }) => {
  await page.addInitScript((server) => {
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [server] }))
  }, server)
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== server) return route.fallback()
    if (url.pathname === "/api/event") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"id":"evt_connected","type":"server.connected","data":{}}\n\n',
      })
    }
    if (url.pathname === "/api/global/health" || url.pathname === "/api/health") {
      return json(route, { healthy: true, version: "2.0.0" })
    }
    return json(route, {})
  })

  await page.goto("/")
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await settings.getByRole("tab", { name: "Servers" }).click()
  await settings.getByRole("button", { name: "Add server" }).click()

  const editor = page.getByRole("dialog", { name: "Add server" })
  await expect(editor.getByPlaceholder("http://localhost:4096")).toBeFocused()
  const username = editor.getByPlaceholder("username")
  const password = editor.getByPlaceholder("password")
  await username.click()
  await expect(username).toBeFocused()
  await username.fill("kit")
  await expect(username).toHaveValue("kit")
  await page.keyboard.press("Tab")
  await expect(password).toBeFocused()
  await password.fill("secret")
  await expect(password).toHaveValue("secret")
  await page.keyboard.press("Escape")
  await expect(editor).toBeHidden()
  await expect(settings).toBeVisible()
})

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}
