import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "/console-auth-project"
const location = { directory, project: { id: "proj_console", directory, canonical: directory } }
const provider = {
  id: "opencode",
  integrationID: "opencode",
  name: "Anomaly / OpenCode",
  activation: "enabled",
  package: "@ai-sdk/openai-compatible",
}
const secondProvider = {
  ...provider,
  id: "console-google",
  canonical: "google",
  name: "Anomaly / Google",
  package: "@ai-sdk/google",
}
const directProvider = {
  ...provider,
  id: "openrouter",
  integrationID: "openrouter",
  canonical: "openrouter",
  name: "OpenRouter",
}
const model = {
  id: "sonnet",
  modelID: "sonnet",
  providerID: provider.id,
  name: "Console Sonnet",
  enabled: true,
  status: "active",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  cost: [],
  time: { released: 1700000000000 },
  limit: { context: 200000, output: 32000 },
}
const models = [
  model,
  ...Array.from({ length: 18 }, (_, index) => ({
    ...model,
    id: `model-${index + 2}`,
    modelID: `model-${index + 2}`,
    name: `Console Model ${index + 2}`,
  })),
  { ...model, id: "gemini", modelID: "gemini", providerID: secondProvider.id, name: "Console Gemini" },
]
const directModel = {
  ...model,
  id: "openrouter-model",
  modelID: "openrouter-model",
  providerID: directProvider.id,
  name: "OpenRouter Model",
  cost: [{ input: 1, output: 1, cache: { read: 0, write: 0 } }],
}
const integration = {
  id: "opencode",
  name: "OpenCode",
  connections: [],
  methods: [
    {
      id: "device",
      type: "oauth",
      label: "OpenCode Console account",
      form: [
        {
          key: "server",
          type: "string",
          format: "uri",
          hidden: true,
          default: "https://opencode.ai/console",
        },
      ],
    },
    { type: "key", label: "API key (service account)" },
  ],
}

async function fixture(
  page: Page,
  remote = false,
  options: {
    draft?: boolean
    browserFailed?: boolean
    slowStart?: Promise<void>
    existingProvider?: boolean
    singleProvider?: boolean
    stagedCatalog?: boolean
    paidModels?: boolean
    staleIntegration?: boolean
    directProvider?: boolean
  } = {},
) {
  const state = {
    status: "pending",
    connected: false,
    starts: 0,
    cancelled: [] as string[],
    models: true,
    modelError: false,
    statusError: false,
    startError: false,
    startGate: options.slowStart,
    catalogReady: !options.stagedCatalog,
  }
  const server = remote ? "http://production.example:4096" : undefined
  const currentIntegration = () => ({
    ...integration,
    connections:
      state.connected && !options.staleIntegration
        ? [{ type: "credential", id: "cred_console", label: "Anomaly" }]
        : [],
  })
  await mockOpenCodeServer(page, {
    server,
    directory,
    provider: [],
    sessions: [],
    project: {
      id: "proj_console",
      canonical: directory,
      name: "Console test",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    pageMessages: () => ({ items: [] }),
  })
  await page
    .context()
    .route("https://console.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Console fixture</title><p>Authorize access</p>" }),
    )
  await page.route("**/api/integration**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "OPTIONS") return route.fallback()
    const headers = { "access-control-allow-origin": "*" }
    const json = (data: unknown) => route.fulfill({ headers, json: { location, data } })
    if (path === "/api/integration") return json([currentIntegration()])
    if (path === "/api/integration/opencode") return json(currentIntegration())
    if (path === "/api/integration/opencode/connect/oauth") {
      expect(request.postDataJSON()).toEqual({
        methodID: "device",
        answer: { server: "https://opencode.ai/console" },
      })
      state.starts++
      if (state.startGate) await state.startGate
      if (state.startError) return route.fulfill({ status: 503, headers })
      return json({
        attemptID: `con_${state.starts}`,
        mode: "auto",
        instructions: "Confirmation code: TFXS-STXG",
        url: "https://console.example/device?user_code=TFXS-STXG&client_id=opencode-cli",
        time: { created: Date.now(), expires: Date.now() + 60000 },
      })
    }
    if (path.includes("/connect/oauth/con_")) {
      if (request.method() === "DELETE") {
        state.cancelled.push(path.split("/").pop()!)
        return route.fulfill({ status: 204, headers })
      }
      if (state.statusError) return route.fulfill({ status: 503, headers })
      if (state.status === "complete") state.connected = true
      return json({
        status: state.status,
        ...(state.status === "failed" ? { message: "Device authorization failed: access_denied" } : {}),
        time: { created: 0, expires: Date.now() + 60000 },
      })
    }
    return route.fallback()
  })
  await page.route("**/api/provider**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    return route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        location,
        data: !state.connected
          ? options.existingProvider
            ? [directProvider]
            : []
          : state.catalogReady
            ? [provider, ...(options.singleProvider ? [] : [secondProvider])].concat(
                options.directProvider || options.existingProvider ? [directProvider] : [],
              )
            : [{ ...provider, name: "OpenCode Zen" }],
      },
    })
  })
  await page.route("**/api/model**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    if (state.modelError) return route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" } })
    const available = state.connected && state.models
    const source = options.directProvider || options.existingProvider ? [...models, directModel] : models
    const catalog = options.paidModels
      ? source.map((model) => ({ ...model, cost: [{ input: 1, output: 1, cache: { read: 0, write: 0 } }] }))
      : source
    return route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        location,
        data: new URL(route.request().url()).pathname.endsWith("/default")
          ? available
            ? catalog[0]
            : null
          : available
            ? !state.catalogReady
              ? catalog.filter((model) => model.providerID === provider.id).slice(0, 6)
              : options.singleProvider
                ? catalog.filter((model) => model.providerID === provider.id)
                : catalog
            : options.existingProvider
              ? [directModel]
              : [],
      },
    })
  })
  await page.route("**/api/credential/**", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback()
    state.connected = false
    state.status = "pending"
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    await page.evaluate(() => {
      const host = window as Window & { __mockServerStream?: { push: (events: unknown[]) => void } }
      if (!host.__mockServerStream) throw new Error("Missing fixture event stream")
      host.__mockServerStream.push([
        { id: "evt_credential_removed", type: "credential.updated", data: {} },
        {
          id: "evt_credential_switched",
          type: "credential.switched",
          data: { integrationID: "opencode", credentialID: null },
        },
      ])
    })
  })
  await page.addInitScript(
    ({ directory, server }) => {
      if (server) localStorage.setItem("opencode.settings.dat:defaultServerUrl", server)
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          list: server ? [{ type: "http", displayName: "Production server", http: { url: server } }] : [],
          projects: { [server ?? "local"]: [{ worktree: directory, expanded: true }] },
        }),
      )
    },
    { directory, server },
  )
  const params = new URLSearchParams()
  if (server) params.set("server", server)
  if (options.browserFailed) params.set("browserFailed", "1")
  await page.goto(`/e2e/desktop/index.html?${params}`)
  const dialog = page.locator('[data-component="dialog-v2"]').getByRole("dialog")
  if (options.draft) {
    await page.keyboard.press("Control+t")
    const composer = page.locator('[data-component="composer-editor"]')
    await expect(composer).toBeEditable()
    await composer.fill("Keep this draft throughout sign-in")
    const tip = page.locator('[data-component="new-session-tip"]')
    await expect(tip).toContainText("Connect to 75+ providers")
    await tip.getByRole("button", { name: /Connect to 75\+ providers/ }).click()
    await dialog.getByRole("button", { name: /^OpenCode / }).click()
    await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
    await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
    return { state, dialog }
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Providers", exact: true }).click()
  // Use the picker so this also exercises the existing Settings entry point.
  await page.getByRole("button", { name: "Show more providers", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^OpenCode / })
    .click()
  await expect(dialog.getByRole("button", { name: "Continue to OpenCode Console" })).toBeEnabled()
  return { state, dialog }
}

test("Console account is primary and the code is displayed without a copy-code step", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  await expect(dialog.getByRole("heading", { name: "Connect OpenCode", exact: true })).toBeVisible()
  await expect(dialog.getByText("Service account?", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Use API key", exact: true })).toBeVisible()
  const shell = await dialog.boundingBox()
  const back = await dialog.getByRole("button", { name: "Navigate back" }).boundingBox()
  const heading = await dialog.getByRole("heading", { name: "Connect OpenCode", exact: true }).boundingBox()
  const logo = await dialog.locator('[data-component="opencode-logo"]').boundingBox()
  const description = await dialog
    .getByText("Sign in with your OpenCode Console account to use the available models.")
    .boundingBox()
  const primary = await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).boundingBox()
  const service = await dialog.locator('[data-component="console-service-account"]').boundingBox()
  if (!shell || !back || !heading || !logo || !description || !primary || !service)
    throw new Error("Missing dialog layout")
  expect(shell.height).toBe(512)
  expect(back.x - shell.x).toBe(20)
  expect(back.y - shell.y).toBe(16)
  expect(heading.y - (back.y + back.height)).toBe(12)
  expect(logo.y + logo.height / 2).toBe(heading.y + heading.height / 2)
  expect(description.y - (heading.y + heading.height)).toBe(24)
  expect(primary.y - (description.y + description.height)).toBe(20)
  expect(service.y - (primary.y + primary.height)).toBe(20)
  await page.screenshot({ path: test.info().outputPath("connect-console-light.png") })
  const popup = page.waitForEvent("popup")
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  const consolePage = await popup
  await expect(consolePage).toHaveURL(/user_code=TFXS-STXG/)
  await expect(consolePage).toHaveURL(/client_id=opencode-desktop/)
  await expect(consolePage).toHaveURL(/return_window=console-auth-fixture/)
  await expect(
    dialog.getByText("Continue in your browser. Confirm the code shown there matches the one below."),
  ).toBeVisible()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  await expect(dialog.getByRole("textbox")).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Copy sign-in link" })).toBeVisible()
  const authHeading = await dialog.getByRole("heading", { name: "Connecting to OpenCode" }).boundingBox()
  const authDescription = await dialog
    .getByText("Continue in your browser. Confirm the code shown there matches the one below.")
    .boundingBox()
  const label = await dialog.getByText("Device code", { exact: true }).boundingBox()
  const code = await dialog.getByRole("group", { name: "Device code: TFXS-STXG" }).boundingBox()
  const waiting = await dialog.getByRole("status").boundingBox()
  const fallback = await dialog.locator('[data-component="console-browser-fallback"]').boundingBox()
  const authShell = await dialog.boundingBox()
  if (!authHeading || !authDescription || !label || !code || !waiting || !fallback || !authShell)
    throw new Error("Missing authorization layout")
  expect(authDescription.y - (authHeading.y + authHeading.height)).toBe(24)
  expect(label.y - (authDescription.y + authDescription.height)).toBe(20)
  expect(code.y - (label.y + label.height)).toBe(8)
  expect(code.height).toBe(48)
  expect(waiting.y - (code.y + code.height)).toBe(8)
  expect(fallback.y - (waiting.y + waiting.height)).toBe(20)
  expect(authShell.height).toBeLessThan(512)
  expect(authShell.y + authShell.height - (fallback.y + fallback.height)).toBe(16)
  await page.screenshot({ path: test.info().outputPath("console-auth-light.png") })
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.screenshot({ path: test.info().outputPath("console-auth-dark.png") })
  state.status = "complete"
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  const list = dialog.getByRole("radiogroup", { name: "Models available from OpenCode" })
  const available = dialog.locator('[data-component="available-models-heading"]')
  await expect(available).toContainText("Available models")
  await expect(available).toContainText("Anomaly")
  await expect(dialog.getByRole("button", { name: "OpenCode", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Google", exact: true })).toBeVisible()
  await expect(list.getByRole("radio")).toHaveCount(models.length)
  await page.mouse.move(0, 0)
  const first = list.getByRole("radio", { name: "Console Sonnet" })
  await expect(first).toBeChecked()
  await expect(first).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(dialog.locator('[data-component="settings-list"]')).toHaveCount(2)
  await expect(first.locator('[data-slot="settings-row-title"]')).toHaveCSS("font-weight", "440")
  await expect(first).toHaveCSS("border-radius", "4px")
  const providerGroups = dialog.locator('[data-component="provider-model-group"]')
  await expect(providerGroups).toHaveCount(2)
  const openCodeGroup = dialog.locator('[data-component="provider-model-group"][data-provider="opencode"]')
  await expect(openCodeGroup).toHaveCSS("border-radius", "8px")
  await expect
    .poll(() =>
      openCodeGroup.evaluate((element) => {
        const list = element.querySelector<HTMLElement>('[data-component="settings-list"]')
        if (!list) return false
        const background = getComputedStyle(element).backgroundColor
        return background !== "rgba(0, 0, 0, 0)" && getComputedStyle(list).backgroundColor === "rgba(0, 0, 0, 0)"
      }),
    )
    .toBe(true)
  await expect(providerGroups.getByText(/models? enabled$/)).toHaveCount(0)
  const google = dialog.getByRole("button", { name: "Google", exact: true })
  await expect(
    dialog.locator(
      '[data-component="provider-model-group"][data-provider="console-google"] [data-component="provider-icon"] use',
    ),
  ).toHaveAttribute("href", /#google$/)
  const gemini = list.getByRole("radio", { name: "Console Gemini" })
  const geminiShell = list
    .locator('[data-component="connected-model-row-shell"]')
    .filter({ hasText: /^Console Gemini$/ })
  await expect(gemini).toHaveCSS("height", "40px")
  await expect(geminiShell).toHaveCSS("margin-left", "4px")
  await google.click()
  await expect(google).toHaveAttribute("aria-expanded", "false")
  await expect(gemini).toBeHidden()
  await google.click()
  await expect(google).toHaveAttribute("aria-expanded", "true")
  await expect(dialog.locator('[data-slot="dialog-header"]')).toHaveCSS("padding-top", "20px")
  const hovered = list.getByRole("radio", { name: "Console Model 3" })
  const hoveredShell = list
    .locator('[data-component="connected-model-row-shell"]')
    .filter({ hasText: /^Console Model 3$/ })
  await expect(hoveredShell).toHaveCSS("margin-left", "4px")
  await expect(hoveredShell).toHaveCSS("padding-top", "4px")
  await expect(hovered).toHaveCSS("height", "40px")
  await hovered.hover()
  await expect
    .poll(() => hovered.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)")
  await expect(hovered).toHaveCSS("border-bottom-width", "0px")
  await expect(list.getByRole("radio", { name: "Console Model 2" })).toHaveCSS("border-bottom-width", "0px")
  await page.screenshot({ path: test.info().outputPath("first-provider-models-dark.png") })
  await list.getByRole("radio", { name: "Console Model 2" }).click()
  await expect(list.getByRole("radio", { name: "Console Model 2" })).toBeChecked()
  const scroll = dialog.locator('[data-component="first-provider-model-scroll"]')
  const footer = dialog.locator('[data-component="first-provider-model-footer"]')
  const footerBefore = await footer.boundingBox()
  expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await expect(list.getByRole("radio", { name: models.at(-1)!.name })).toBeInViewport()
  expect(await footer.boundingBox()).toEqual(footerBefore)
  await dialog.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(page.locator('[data-action="composer-model"]')).toContainText("Console Model 2")
  expect(state.starts).toBe(1)
  expect(state.cancelled).toEqual([])
})

test("provider form returns to the picker and its backdrop closes", async ({ page }) => {
  const { dialog } = await fixture(page)
  await dialog.getByRole("button", { name: "Navigate back", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Connect provider", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^OpenCode / })).toBeVisible()
  await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 8, y: 8 } })
  await expect(dialog).toBeHidden()
})

test("Manage models groups Console providers like Settings", async ({ page }) => {
  const { state, dialog } = await fixture(page, false, { draft: true, paidModels: true, directProvider: true })
  state.status = "complete"
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  await dialog.getByRole("button", { name: "Continue", exact: true }).click()
  await page.locator('[data-action="composer-model"]').click()
  const search = page.getByPlaceholder("Search models", { exact: true })
  await expect(search).toBeFocused()
  await search.press("ArrowUp")
  await search.press("Enter")

  await expect(dialog.getByRole("heading", { name: "Manage models", exact: true })).toBeVisible()
  const managed = dialog.locator('[data-component="manage-models-console"]')
  await expect(managed.getByRole("button", { name: "OpenCode Anomaly", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  )
  await expect(managed.locator('[data-component="provider-model-group"]')).toHaveCount(2)
  await expect(managed.getByRole("button", { name: /^Google \d+ models? enabled$/ })).toBeVisible()
  await expect(managed.getByText("Anomaly / Google", { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "OpenRouter", exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Connect provider", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Connect provider", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^OpenCode Reliable optimized models/ })).toHaveCount(0)
})

test("Manage models opens the Models settings page", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "complete"
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  await dialog.getByRole("button", { name: "Manage models", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("tab", { name: "Models", exact: true })).toHaveAttribute("aria-selected", "true")
  const console = page.locator('[data-component="settings-models-console"]')
  const consoleToggle = console.getByRole("button", { name: "OpenCode Anomaly", exact: true })
  await expect(consoleToggle).toHaveAttribute("aria-expanded", "true")
  const groups = console.locator('[data-component="provider-model-group"]')
  await expect(groups).toHaveCount(2)
  await expect(console.locator(".settings-models-console-groups")).toHaveCSS("border-inline-start-style", "solid")
  const openCode = console.locator('[data-component="provider-model-group"][data-provider="opencode"]')
  await expect(openCode).toBeVisible()
  const openCodeToggle = openCode.getByRole("button", { name: "OpenCode 0 models enabled", exact: true })
  await expect(openCodeToggle).toBeVisible()
  const divider = openCode.locator('[data-component="settings-list"]')
  await openCodeToggle.hover()
  await expect(openCode).toHaveCSS("outline-style", "solid")
  await expect(divider).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)")
  await expect(openCodeToggle.locator(".provider-model-group-chevron")).toHaveCSS("margin-left", "-2px")
  await openCode.getByRole("switch", { name: "Console Model 2" }).press("Space")
  await expect(openCode.getByRole("button", { name: "OpenCode 1 model enabled", exact: true })).toBeVisible()
  await consoleToggle.click()
  await expect(groups).toHaveCount(0)
  await consoleToggle.click()
  await expect(groups).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath("settings-console-models.png") })
  await page.evaluate(() => {
    document.documentElement.dir = "rtl"
  })
  await expect(console.locator(".settings-models-console-groups")).toHaveCSS("border-right-style", "solid")
  await page.screenshot({ path: test.info().outputPath("settings-console-models-rtl.png") })
})

test("a single managed provider uses a collapsible container", async ({ page }) => {
  const { state, dialog } = await fixture(page, false, { singleProvider: true })
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "complete"
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Anomaly / OpenCode", exact: true })).toHaveCount(0)
  const provider = dialog.getByRole("button", { name: "OpenCode", exact: true })
  await expect(provider).toHaveAttribute("aria-expanded", "true")
  await provider.click()
  await expect(dialog.getByRole("radio", { name: "Console Sonnet" })).toBeHidden()
  await provider.click()
  await expect(dialog.getByRole("radio", { name: "Console Sonnet" })).toBeVisible()
  await expect(dialog.locator('[data-component="available-models-heading"]')).toContainText("Available models")
  await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 8, y: 8 } })
  await expect(dialog).toBeHidden()
})

test("model choice is skipped after a provider has already been connected", async ({ page }) => {
  const { state, dialog } = await fixture(page, false, { existingProvider: true })
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "complete"
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("tab", { name: "Providers", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("OpenCode Console connected", { exact: true })).toBeVisible()
  const connected = page.locator('[data-component="connected-providers-section"]')
  await connected.getByRole("button", { name: "2 providers available", exact: true }).click()
  await connected.getByRole("button", { name: "Google", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Models", exact: true })).toHaveAttribute("aria-selected", "true")
  const card = page.locator('[data-component="provider-model-group"][data-provider="console-google"]')
  const search = page.getByRole("searchbox", { name: "Search models", exact: true })
  await expect(card).toBeVisible()
  await expect
    .poll(async () => {
      const cardBox = await card.boundingBox()
      const searchBox = await search.boundingBox()
      if (!cardBox || !searchBox) return false
      return cardBox.y >= searchBox.y + searchBox.height + 20
    })
    .toBe(true)
})

test("Console reconnect clears disconnected provider suppression", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "complete"
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()

  const connected = page.locator('[data-component="connected-providers-section"]')
  await expect(connected.getByText("OpenCode", { exact: true })).toBeVisible()
  await connected.getByRole("button", { name: "Disconnect", exact: true }).click()
  await expect(connected).toContainText("No connected providers")
  const popular = page.getByRole("heading", { name: "Popular providers", exact: true }).locator("..")
  await expect(popular.getByRole("button", { name: "Connect", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Show more providers", exact: true }).click()
  await dialog.getByRole("button", { name: /^OpenCode / }).click()
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "complete"
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(connected.getByText("OpenCode", { exact: true })).toBeVisible()
  await expect(connected.getByText("Anomaly", { exact: true })).toBeVisible()
})

test("service-account API key form matches the Console dialog layout", async ({ page }) => {
  const { dialog } = await fixture(page)
  const initialShell = await dialog.boundingBox()
  await dialog.getByRole("button", { name: "Use API key", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Connect OpenCode", exact: true })).toBeVisible()
  const description = dialog.getByText("Connect using a service-account API key from OpenCode Console.")
  const label = dialog.locator('[data-component="provider-api-key-label"]')
  const input = dialog.getByLabel("OpenCode Console API key", { exact: true })
  const button = dialog.getByRole("button", { name: "Continue", exact: true })
  await expect(input).toBeFocused()
  const shell = await dialog.boundingBox()
  const heading = await dialog.getByRole("heading", { name: "Connect OpenCode", exact: true }).boundingBox()
  const descriptionBox = await description.boundingBox()
  const labelBox = await label.boundingBox()
  const fieldBox = await input.locator("..").locator("..").boundingBox()
  const buttonBox = await button.boundingBox()
  if (!shell || !heading || !descriptionBox || !labelBox || !fieldBox || !buttonBox)
    throw new Error("Missing API key dialog layout")
  if (!initialShell) throw new Error("Missing initial Console dialog layout")
  expect(shell.height).toBe(512)
  expect(shell.height).toBe(initialShell.height)
  expect(descriptionBox.y - (heading.y + heading.height)).toBe(24)
  expect(labelBox.y - (descriptionBox.y + descriptionBox.height)).toBe(20)
  expect(fieldBox.y - (labelBox.y + labelBox.height)).toBe(8)
  expect(buttonBox.y - (fieldBox.y + fieldBox.height)).toBe(20)
  await page.screenshot({ path: test.info().outputPath("console-api-key-light.png") })
})

test("setup preserves the draft and Continue restores composer focus", async ({ page }) => {
  const { state, dialog } = await fixture(page, false, { draft: true })
  state.status = "complete"
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  await dialog.getByRole("button", { name: "Continue", exact: true }).click()
  const composer = page.locator('[data-component="composer-editor"]')
  await expect(composer).toHaveText("Keep this draft throughout sign-in")
  await expect(composer).toBeFocused()
  await expect(page.locator('[data-action="composer-model"]')).toContainText("Console Sonnet")
})

test("catalog refresh failure retries without asking for authorization again", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.modelError = true
  state.status = "complete"
  await expect(dialog.getByRole("alert")).toContainText("Your account is connected, but we couldn't load your models")
  state.modelError = false
  await dialog.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  expect(state.starts).toBe(1)
})

test("status request failure resumes the existing attempt", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  state.statusError = true
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  const alert = dialog.getByRole("alert")
  await expect(alert).toBeVisible()
  await expect(alert).toHaveClass(/text-v2-text-text-base/)
  await expect(alert.locator("svg")).toHaveClass(/text-v2-state-fg-danger/)
  state.statusError = false
  state.status = "complete"
  await dialog.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  expect(state.starts).toBe(1)
  expect(state.cancelled).toEqual([])
})

test("retrying authorization startup keeps the error view busy", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  state.startError = true
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  const alert = dialog.getByRole("alert")
  await expect(alert).toContainText("Couldn't start sign-in")
  await expect(dialog.getByRole("heading", { name: "Connect to OpenCode", exact: true })).toBeVisible()
  await expect(dialog.locator('[data-component="provider-connect-content"]')).toHaveCSS("padding-left", "12px")

  const retry = Promise.withResolvers<void>()
  state.startError = false
  state.startGate = retry.promise
  await dialog.getByRole("button", { name: "Try again", exact: true }).click()
  const opening = dialog.getByRole("button", { name: "Opening browser…", exact: true })
  await expect(opening).toBeDisabled()
  await expect(alert).toContainText("Couldn't start sign-in")

  const popup = page.waitForEvent("popup")
  retry.resolve()
  await popup
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
})

test("backdrop clicks do not cancel Console authorization", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 8, y: 8 } })
  await expect(dialog).toBeVisible()
  expect(state.cancelled).toEqual([])
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect.poll(() => state.cancelled).toEqual(["con_1"])
})

test("first connection waits for the managed Console catalog", async ({ page }) => {
  const { state, dialog } = await fixture(page, false, { stagedCatalog: true, directProvider: true })
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "complete"
  await expect(dialog.getByRole("status")).toContainText("Waiting for confirmation")
  await expect(dialog.getByText("OpenCode connected. Loading your models", { exact: true })).toHaveCount(0)
  await expect(dialog.locator('[data-component="first-provider-models"]')).toHaveCount(0)
  const connected = page.locator('[data-component="connected-providers-section"]')
  await expect(connected.getByText("OpenCode Zen", { exact: true })).toHaveCount(0)

  state.catalogReady = true
  await page.evaluate((directory) => {
    const host = window as Window & { __mockServerStream?: { push: (events: unknown[]) => void } }
    if (!host.__mockServerStream) throw new Error("Missing fixture event stream")
    host.__mockServerStream.push([
      { id: "evt_console_provider", type: "provider.updated", location: { directory }, data: {} },
    ])
  }, directory)

  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  await expect(dialog.locator('[data-component="provider-model-group"]')).toHaveCount(2)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(connected.getByText("OpenCode", { exact: true })).toBeVisible()
  await expect(connected.getByText("Anomaly", { exact: true })).toBeVisible()
  const consoleRow = connected.locator(".settings-provider-console-header")
  const directRow = connected.locator(".settings-provider-row").filter({ hasText: "OpenRouter" })
  await expect(directRow).toBeVisible()
  await expect.poll(async () => (await directRow.boundingBox())?.height).toBe((await consoleRow.boundingBox())?.height)
})

test("closing during authorization startup cancels the late server attempt", async ({ page }) => {
  const start = Promise.withResolvers<void>()
  const { state, dialog } = await fixture(page, false, { slowStart: start.promise })
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect.poll(() => state.starts).toBe(1)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
  start.resolve()
  await expect.poll(() => state.cancelled).toEqual(["con_1"])
})

test("authorization startup stays on the Continue button until the device code is ready", async ({ page }) => {
  const start = Promise.withResolvers<void>()
  const { dialog } = await fixture(page, false, { slowStart: start.promise })
  const button = dialog.getByRole("button", { name: "Continue to OpenCode Console" })
  await button.click()
  await expect(dialog.getByRole("button", { name: "Opening browser…" })).toHaveAttribute("aria-busy", "true")
  await expect(dialog.getByRole("heading", { name: "Connect OpenCode", exact: true })).toBeVisible()
  await expect(dialog.getByRole("group", { name: /Device code/ })).toHaveCount(0)
  start.resolve()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
})

test("browser failure offers a copyable sign-in link in a narrow RTL window", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const { dialog } = await fixture(page, false, { browserFailed: true })
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByText(/We couldn't open your browser/)).toBeVisible()
  await page.setViewportSize({ width: 380, height: 650 })
  await page.evaluate(() => {
    document.documentElement.dir = "rtl"
  })
  const code = dialog.getByRole("group", { name: "Device code: TFXS-STXG" })
  await expect(code).toHaveCSS("direction", "ltr")
  await expect(code).toBeInViewport()
  await dialog.getByRole("button", { name: "Copy sign-in link" }).click()
  await expect(dialog.getByRole("button", { name: "Sign-in link copied" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://console.example/device?user_code=TFXS-STXG&client_id=opencode-desktop&return_window=console-auth-fixture",
  )
  await expect(dialog.getByRole("button", { name: "Open Console again" })).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath("console-auth-narrow-rtl.png") })
})

test("cancel releases the server attempt and retrying expiration creates a new attempt", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "expired"
  await expect(dialog.getByRole("alert")).toContainText("has expired")
  state.status = "pending"
  await dialog.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  await expect.poll(() => state.starts).toBe(2)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect.poll(() => state.cancelled).toEqual(["con_1", "con_2"])
})

test("an authorized workspace without models stays connected and can refresh", async ({ page }) => {
  const { state, dialog } = await fixture(page)
  state.models = false
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  state.status = "complete"
  await expect(dialog.getByText(/this Console workspace has no available models/)).toBeVisible()
  state.models = true
  await dialog.getByRole("button", { name: "Refresh models" }).click()
  await expect(dialog.getByRole("heading", { name: "Connected to OpenCode" })).toBeVisible()
  expect(state.starts).toBe(1)
})

test("remote disclosure precedes authorization and all auth requests target that server", async ({ page }) => {
  const { state, dialog } = await fixture(page, true)
  await expect(dialog.getByRole("note")).toContainText("Connecting on “Production server”")
  await expect(dialog.getByRole("note")).toContainText("credentials will be stored on this server")
  expect(state.starts).toBe(0)
  const request = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/connect/oauth"),
  )
  await dialog.getByRole("button", { name: "Continue to OpenCode Console" }).click()
  expect(new URL((await request).url()).origin).toBe("http://production.example:4096")
  await expect(dialog.getByRole("group", { name: "Device code: TFXS-STXG" })).toBeVisible()
  const cancelled = page.waitForRequest(
    (request) => request.method() === "DELETE" && request.url().includes("/connect/oauth"),
  )
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  expect(new URL((await cancelled).url()).origin).toBe("http://production.example:4096")
})
