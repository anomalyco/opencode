import { expect, test } from "@playwright/test"

test("pairs locally without checking the server and authenticates subsequent requests", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:3000").origin
  const password = "pairing-secret"
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const requests: { origin: string; authorization: string | undefined }[] = []
  await page.addInitScript((origin) => {
    if (localStorage.getItem("opencode.global.dat:server")) return
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ list: [{ type: "http", http: { url: origin, password: "old-password" } }] }),
    )
  }, origin)
  await page.route("**/api/**", async (route) => {
    requests.push({
      origin: new URL(route.request().url()).origin,
      authorization: route.request().headers().authorization,
    })
    // Pairing must succeed even when the API is unavailable.
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  })

  await page.goto(`/connect?data=${encodeURIComponent(JSON.stringify({ username: "opencode", password }))}`)
  await expect(page).toHaveURL(`${origin}/`)
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}").list))
    .toEqual([{ type: "http", http: { url: origin, password } }])
  await expect.poll(() => requests.filter((request) => request.origin === origin).length).toBeGreaterThan(0)
  expect(
    requests.filter((request) => request.origin === origin).every((request) => request.authorization === authorization),
  ).toBe(true)

  requests.length = 0
  await page.reload()
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible()
  await expect.poll(() => requests.filter((request) => request.origin === origin).length).toBeGreaterThan(0)
  expect(
    requests.filter((request) => request.origin === origin).every((request) => request.authorization === authorization),
  ).toBe(true)
})

test("the hosted app hands HTTP-only pairing links over to the server's own web UI", async ({ page, baseURL }) => {
  const dev = new URL(baseURL ?? "http://127.0.0.1:3000").origin
  const hosted = "https://app.opencode.ai"
  const lan = "http://192.168.1.20:49374"
  // Serve the dev build under the hosted HTTPS origin so mixed-content rules apply to the page.
  await page.route(`${hosted}/**`, async (route) => {
    const response = await page.request.fetch(route.request().url().replace(hosted, dev))
    await route.fulfill({ response })
  })
  await page.route(`${lan}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>served</title>" }),
  )
  const requests: string[] = []
  await page.route("**/api/**", async (route) => {
    requests.push(route.request().url())
    await route.abort()
  })
  const info = { urls: [lan], username: "opencode", password: "lan-secret" }
  const fragment = Buffer.from(JSON.stringify(info)).toString("base64url")

  await page.goto(`${hosted}/connect#${fragment}`)
  await expect(page.getByRole("heading", { name: "This server is on a local network" })).toBeVisible()
  await expect(page.getByText(lan, { exact: true })).toBeVisible()
  expect(requests).toEqual([])

  await page.getByRole("button", { name: "Open on local network" }).click()
  await expect(page).toHaveURL(`${lan}/connect#${fragment}`)
})

test("the unpaired page loads without starting server requests", async ({ page }) => {
  const requests: string[] = []
  await page.route("**/api/**", async (route) => {
    requests.push(route.request().url())
    await route.abort()
  })
  await page.goto("/connect")
  await expect(page.getByRole("heading", { name: "Connect to a server" })).toBeVisible()
  await expect(page.getByLabel("Password", { exact: true })).toBeEditable()
  expect(requests).toEqual([])
})
