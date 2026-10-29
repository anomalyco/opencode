import { expect, test, type Locator, type Page } from "@playwright/test"
import { NO_PROVIDER, SERVER, T0, expectPath, holdRoute, provider, sessionHref } from "../utils/app"
import { mockWorkspace, openDraft, openSession } from "../utils/workspace"
import { mockPluginsActivating, type MockServerConfig } from "../utils/mock-server"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test("mention a session by title, send its stable token, and open its own tab", async ({ page }) => {
  const target = "ses_0123456789abcdefghijklmnop"
  const prompts: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0]["body"][] = []

  const view = await openSession(page, {
    name: "SessionMentions",
    findFiles: () => [],
    sessions: [
      { id: "ses_mentions_source", title: "Review the plan" },
      { id: target, title: "Auth middleware" },
    ],
    seed: { tabs: ["ses_mentions_source"] },
    onPrompt: (input) => void prompts.push(input.body),
  })

  await view.editor.fill("Compare with @Auth")
  await page
    .locator('[data-component="composer-suggestions"]')
    .getByRole("button", { name: /Auth middleware/ })
    .click()
  await expect(view.editor.locator('[data-mention="session"]')).toHaveText("@Auth middleware")
  await view.editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.text).toBe(`Compare with @session:${target} `)
  const message = page.locator('[data-timeline-row="UserMessage"]')
  const chip = message.getByRole("button", { name: "Auth middleware", exact: true })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page).toHaveURL(new RegExp(`${target}$`))
  await expect(page.locator("[data-titlebar-tab-link]").filter({ hasText: "Review the plan" })).toHaveCount(1)
  await expect(page.locator('[data-titlebar-tab-slot][data-active="true"]')).toContainText("Auth middleware")
})

test("a bare @ lists sessions, and a multi-word title matches while file search is slow", async ({ page }) => {
  const target = "ses_0123456789opencodeconsolex"
  const prompts: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0]["body"][] = []

  const view = await openSession(page, {
    name: "SessionMentionSearch",
    findFiles: () => [],
    sessions: [
      { id: "ses_mention_search_source", title: "Review the plan" },
      { id: "ses_0123456789homesessionabcde", title: "HOME" },
      { id: target, title: "OPENCODE CONSOLE" },
    ],
    seed: { tabs: ["ses_mention_search_source"] },
    onPrompt: (input) => void prompts.push(input.body),
  })

  const suggestions = page.locator('[data-component="composer-suggestions"]')
  const files = await holdRoute(page, (url) => url.pathname === "/api/fs/find")

  await view.editor.pressSequentially("Compare with @")
  await expect(suggestions.getByRole("button", { name: /HOME/ })).toBeVisible()
  await expect(suggestions.getByRole("button", { name: /OPENCODE CONSOLE/ })).toBeVisible()

  await view.editor.pressSequentially("open")
  await files.arrived
  await view.editor.pressSequentially(" con")
  await expect(suggestions.getByRole("button", { name: /HOME/ })).toHaveCount(0)
  await expect(suggestions.locator("[data-suggestion-id][data-active]")).toContainText("OPENCODE CONSOLE")
  await view.editor.press("Enter")
  await expect(view.editor.locator('[data-mention="session"]')).toHaveText("@OPENCODE CONSOLE")
  files.release()

  // Prose after a completed mention neither reopens the popover nor lets it take Enter.
  await view.editor.pressSequentially("on code")
  await expect(suggestions).toBeHidden()
  await view.editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.text).toBe(`Compare with @session:${target} on code`)

  // A space after a full title ends a typed mention, so the rest stays prose.
  await view.editor.pressSequentially("@home")
  await expect(suggestions.getByRole("button", { name: /HOME/ })).toBeVisible()
  await view.editor.pressSequentially(" now")
  await expect(suggestions).toBeHidden()
  await view.editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(2)
  expect(prompts[1]?.text).toBe("@home now")
})

test("the free usage limit opens the Go dialog once, leaves a readable notice, and restores the prompt", async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(T0)
  await context.route("https://**", (route) => route.fulfill({ body: "Sign in" }))
  const sessionID = "ses_free_limit"
  const model = { id: "big-pickle", providerID: "opencode" }
  const state = { authorized: false }

  const view = await openSession(page, {
    name: "FreeLimit",
    sessions: [{ id: sessionID, agent: "build", model }],
    onFileWrite: () => undefined,
    provider: () => ({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "big-pickle": { id: "big-pickle", name: "Big Pickle", cost: { input: 0, output: 0 }, limit: { context: 200_000 } },
          },
        },
        ...(state.authorized
          ? [
              {
                id: "opencode-go",
                integrationID: "opencode-go",
                name: "OpenCode Go",
                models: {
                  "glm-5-go": { id: "glm-5-go", name: "GLM-5 Go", cost: { input: 1, output: 1 }, limit: { context: 200_000 } },
                },
              },
            ]
          : []),
      ],
      connected: state.authorized ? ["opencode", "opencode-go"] : ["opencode"],
      default: { build: "opencode/big-pickle" },
    }),
    integrations: () => [
      {
        id: "opencode",
        name: "OpenCode Console",
        methods: [{ id: "device", type: "oauth", label: "OpenCode Console account" }],
        connections: state.authorized ? [{ type: "credential", id: "cred_console", label: "Anomaly", method: "oauth" }] : [],
      },
      {
        id: "opencode-go",
        name: "OpenCode Go",
        methods: [{ type: "key" }],
        connections: state.authorized ? [{ type: "credential", id: "cred_go", label: "Go key", method: "key" }] : [],
      },
    ],
    onConnectKey: (input) => {
      if (input.integrationID === "opencode-go") state.authorized = true
    },
    pageMessages: () => ({
      items: [
        { id: "msg_free_user", type: "user", text: "Refactor the parser", time: { created: T0 } },
        { id: "msg_free_assistant", type: "assistant", agent: "build", model, content: [], time: { created: T0 + 1 } },
      ],
    }),
  })

  await expect(page.getByText("Refactor the parser", { exact: true })).toBeVisible()

  const error = {
    type: "provider.free-limit",
    message: "Free usage limit reached.",
    status: 429,
    retryAfterMs: 3_600_000,
  }

  const durable = (seq: number) => ({ aggregateID: sessionID, seq, version: 1 as const })
  const location = { directory: view.directory }

  await view.push([
    {
      id: "evt_free_limit_1",
      created: T0 + 2,
      type: "session.step.failed",
      location,
      durable: durable(1),
      data: { sessionID, assistantMessageID: "msg_free_assistant", error },
    },
  ])

  const upsell = page.getByRole("dialog", { name: "Free limit reached" })
  await expect(upsell).toContainText("Your free messages reset at")
  await expect(page.getByText(/^You've used today's free messages\. They reset at /)).toBeVisible()
  await expect(view.editor).toHaveText("Refactor the parser")
  await expect(page.getByText("Free usage limit reached.")).toHaveCount(0)

  // Subscribe -> Go API key -> Continue switches the model in the current session without opening a new draft tab.
  await upsell.getByRole("button", { name: "Subscribe", exact: true }).click()
  const connect = page.getByRole("dialog", { name: "Connect OpenCode Go", exact: true })
  await connect.getByPlaceholder("API key").fill("sk-go-test")
  await connect.getByRole("button", { name: "Continue", exact: true }).click()
  const connected = page.getByRole("dialog", { name: "Connected to OpenCode Go" })
  await expect(connected.getByRole("radio", { name: "GLM-5 Go", exact: true })).toHaveAttribute("aria-checked", "true")
  await connected.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expectPath(page, sessionHref(sessionID))
  await expect(page.locator("[data-titlebar-tab-slot]")).toHaveCount(1)
  await expect(page.locator('[data-action="composer-model"]')).toContainText("GLM-5 Go")
  await expect(view.editor).toHaveText("Refactor the parser")

  // After the 24-hour window, "Don't show again" permanently suppresses the dialog across reloads, and an attachment-only draft survives.
  const day2 = T0 + 2 * 86_400_000
  await page.clock.setFixedTime(day2)

  await view.push([
    {
      id: "evt_free_limit_2",
      created: day2 + 1,
      type: "session.step.started",
      location,
      durable: durable(2),
      data: { sessionID, assistantMessageID: "msg_free_assistant_2", agent: "build", model, started: day2 + 1 },
    },
    {
      id: "evt_free_limit_3",
      created: day2 + 2,
      type: "session.step.failed",
      location,
      durable: durable(3),
      data: { sessionID, assistantMessageID: "msg_free_assistant_2", error },
    },
  ])

  await upsell.getByRole("button", { name: "Don't show again", exact: true }).click()
  await expect(upsell).toHaveCount(0)

  const later = T0 + 4 * 86_400_000
  await page.clock.setFixedTime(later)
  await page.reload()
  await expect(view.editor).toBeVisible()
  await view.editor.fill("")
  await page.locator('input[type="file"]').setInputFiles({
    name: "diagram.png",
    mimeType: "image/png",
    buffer: Buffer.from("png-bytes"),
  })
  await expect(
    page.locator('[data-component="composer-attachments"]').getByRole("img", { name: "diagram.png", exact: true }),
  ).toBeVisible()

  await view.push([
    {
      id: "evt_free_limit_4",
      created: later + 3,
      type: "session.step.started",
      location,
      durable: durable(4),
      data: { sessionID, assistantMessageID: "msg_free_assistant_3", agent: "build", model, started: later + 3 },
    },
    {
      id: "evt_free_limit_5",
      created: later + 4,
      type: "session.step.failed",
      location,
      durable: durable(5),
      data: { sessionID, assistantMessageID: "msg_free_assistant_3", error },
    },
  ])

  await expect(page.getByRole("status").filter({ hasText: "You've used today's free messages." })).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(
    page.locator('[data-component="composer-attachments"]').getByRole("img", { name: "diagram.png", exact: true }),
  ).toBeVisible()
  await expect(view.editor).toHaveText("")
})

test("a catalog refresh cannot replace an existing session's model", async ({ page }) => {
  const alpha = { id: "alpha", name: "Alpha", variants: { high: {} } }
  const beta = { id: "beta", name: "Beta" }
  const catalog = { current: provider(alpha, beta) }
  const switches: unknown[] = []
  const prompts: unknown[] = []
  const sessionID = "ses_catalog_selection"
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/model`)
      switches.push(request.postDataJSON())
  })

  const view = await openSession(page, {
    name: "CatalogSelection",
    sessions: [{ id: sessionID, agent: "build", model: { id: "alpha", providerID: "opencode", variant: "high" } }],
    provider: () => catalog.current,
    onPrompt: (input) => void prompts.push(input.body),
    seed: { storage: { "opencode.global.dat:model": { recent: [{ providerID: "opencode", modelID: "beta" }] } } },
  })

  const control = page.locator('[data-action="composer-model"]')
  await expect(control).toHaveText("Alpha")
  await view.editor.fill("Keep my selected model")

  catalog.current = provider(beta)
  await view.push([
    {
      id: "evt_catalog_missing",
      created: T0 + 1,
      type: "model.updated",
      location: { directory: view.directory },
      data: {},
    },
  ])
  await expect(control).toHaveText("alpha (unavailable)")
  await view.editor.press("Enter")
  await expect(page.getByText("Select an agent and model", { exact: true })).toBeVisible()
  await expect(view.editor).toHaveText("Keep my selected model")
  expect(switches).toEqual([])
  expect(prompts).toEqual([])

  catalog.current = provider(alpha, beta)
  await view.push([
    {
      id: "evt_catalog_restored",
      created: T0 + 2,
      type: "model.updated",
      location: { directory: view.directory },
      data: {},
    },
  ])
  await expect(control).toHaveText("Alpha")
  await expect(page.getByRole("button", { name: "Choose model variant", exact: true })).toHaveText("high")
  await view.editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  // The session already runs Alpha high, so the send has no switch to make.
  expect(switches).toEqual([])

  catalog.current = provider(beta)
  await view.push([
    {
      id: "evt_catalog_removed",
      created: T0 + 3,
      type: "model.updated",
      location: { directory: view.directory },
      data: {},
    },
  ])
  await expect(control).toHaveText("alpha (unavailable)")
  await control.click()
  await page
    .getByRole("dialog", { name: "Select model" })
    .getByRole("button", { name: "Beta Free", exact: true })
    .click()
  await expect(control).toHaveText("Beta")
  await view.editor.fill("Use the replacement I chose")
  await view.editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(2)
  expect(switches).toEqual([{ model: { id: "beta", providerID: "opencode" } }])
})

test("an existing session's model never shows a fallback while its agent loads", async ({ page }) => {
  const sessionID = "ses_agent_pending"
  await mockWorkspace(page, {
    name: "AgentPending",
    sessions: [{ id: sessionID, agent: "build", model: { id: "alpha", providerID: "opencode" } }],
    provider: provider({ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }),
    seed: { storage: { "opencode.global.dat:model": { recent: [{ providerID: "opencode", modelID: "beta" }] } } },
  })
  const agents = Promise.withResolvers<void>()
  await page.route(/\/api\/agent(\?|$)/, async (route) => {
    await agents.promise
    await route.fallback()
  })

  // Every chip text painted from the first frame, so a fallback shown for even one frame fails the test.
  await page.addInitScript(() => {
    const seen = new Set<string>()
    window.__chipTexts = seen

    const tick = () => {
      const text = document.querySelector('[data-action="composer-model"]')?.textContent

      if (text) seen.add(text)
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  })

  const catalog = ["/api/model", "/api/provider", "/api/config"].map((path) =>
    page.waitForResponse((response) => new URL(response.url()).pathname === path),
  )

  const agentRequested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/agent")
  await page.goto(sessionHref(sessionID))
  await Promise.all(catalog)
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()

  const control = page.locator('[data-action="composer-model"]')
  // The recent model must not stand in for the session's model while its agent is unresolved. The chip may stay
  // hidden or name the session's own model, which the loaded selection then keeps.
  await agentRequested
  const agentLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent")
  agents.resolve()
  await agentLoaded
  await expect(control).toHaveText("Alpha")
  expect(await page.evaluate(() => [...(window.__chipTexts ?? [])])).toEqual(["Alpha"])
})

test("a send pressed while the Location's plugins activate waits, Esc cancels it, and it sends once catalogs load", async ({
  page,
}) => {
  const sessionID = "ses_plugins_booting"
  const prompts: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0]["body"][] = []
  await mockWorkspace(page, {
    name: "PluginsBooting",
    sessions: [{ id: sessionID, agent: "build", model: { id: "alpha", providerID: "opencode" } }],
    provider: provider({ id: "alpha", name: "Alpha" }),
    onPrompt: (input) => void prompts.push(input.body),
  })
  // The server answers the catalogs once plugins activate, and the model list gives up first with a 503.
  await mockPluginsActivating(page)
  const held = await holdRoute(page, /\/api\/(agent|provider|model)(\?|$)/)
  const toast = page.getByText("Select an agent and model")
  const submit = page.locator('[data-action="composer-submit"]')

  try {
    await page.goto(sessionHref(sessionID))
    const editor = page.locator('[data-component="composer-editor"]')
    await expect(editor).toBeEditable()
    await held.arrived
    await editor.fill("ship it")
    await editor.press("Enter")
    await expect(submit).toHaveAttribute("aria-busy", "true")
    // Esc cancels the held send and keeps the prompt for the next press.
    await editor.press("Escape")
    await expect(submit).not.toHaveAttribute("aria-busy", "true")
    await expect(editor).toHaveText("ship it")
    await editor.press("Enter")
    await expect(submit).toHaveAttribute("aria-busy", "true")
    await expect(toast).toHaveCount(0)
    expect(prompts).toEqual([])

    held.release()
    await expect.poll(() => prompts.length).toBe(1)
    expect(prompts[0]).toMatchObject({ text: "ship it" })
    await expect(editor).toHaveText("")
    await expect(submit).not.toHaveAttribute("aria-busy", "true")
    await expect(toast).toHaveCount(0)
  } finally {
    held.release()
  }
})

test("an opened session in another Location names its model from a loaded catalog before its agents load", async ({
  page,
}) => {
  const other = "C:/OpenCode/WarmOther"
  await mockWorkspace(page, {
    name: "WarmOpen",
    sessions: [
      { id: "ses_warm_here", title: "Here", agent: "build", model: { id: "alpha", providerID: "opencode" } },
      {
        id: "ses_warm_there",
        title: "There",
        directory: other,
        location: { directory: other },
        agent: "build",
        model: { id: "beta", providerID: "opencode", variant: "high" },
      },
    ],
    provider: provider({ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta (latest)", variants: { high: {} } }),
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
  })

  const control = page.locator('[data-action="composer-model"]')
  await page.goto(sessionHref("ses_warm_here"))
  await expect(control).toHaveText("Alpha")

  const held = await holdRoute(
    page,
    (url) =>
      ["/api/agent", "/api/config"].includes(url.pathname) && url.searchParams.get("location[directory]") === other,
  )

  try {
    await page.locator(`[data-slot="vertical-tabs"] a[href="${sessionHref("ses_warm_there", SERVER)}"]`).click()
    await held.arrived
    await expect(control).toHaveText("Beta")
    await expect(page.getByRole("button", { name: "Choose model variant" })).toHaveText("high")
    const painted = await control.elementHandle()

    const loaded = ["/api/agent", "/api/config"].map((path) =>
      page.waitForResponse((response) => {
        const url = new URL(response.url())

        return url.pathname === path && url.searchParams.get("location[directory]") === other
      }),
    )

    // A click before the catalog loads opens the dialog once it does.
    await control.click()
    held.release()
    await Promise.all(loaded)
    await expect(page.getByRole("dialog")).toBeVisible()
    // The loaded selection keeps the same chip instead of replacing it.
    await expect(control).toHaveText("Beta")
    expect(await painted?.evaluate((element) => element.isConnected)).toBe(true)
  } finally {
    held.release()
  }
})

declare global {
  interface Window {
    __chipTexts?: Set<string>
  }
}

test("a managed composer label follows direct connections, not picker filtering or model identity", async ({
  page,
}) => {
  const sessionID = "ses_managed_provider"
  const connected = { direct: false }
  const switches: unknown[] = []
  const prompts: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0]["body"][] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/model`)
      switches.push(request.postDataJSON())
  })

  const view = await openSession(page, {
    name: "ManagedProvider",
    sessions: [{ id: sessionID, agent: "build", model: { id: "gpt", providerID: "console-openai" } }],
    provider: () => ({
      all: [
        {
          id: "opencode",
          integrationID: "opencode",
          name: "Anomaly / OpenCode",
          models: {},
        },
        {
          id: "console-openai",
          canonical: "openai",
          integrationID: "opencode",
          name: "Anomaly / OpenAI",
          models: { gpt: { id: "gpt", name: "GPT" } },
        },
        ...(connected.direct
          ? [
              {
                id: "openai",
                name: "OpenAI",
                models: { "direct-model": { id: "direct-model", name: "Direct Model" } },
              },
            ]
          : []),
      ],
      connected: ["opencode", "console-openai", ...(connected.direct ? ["openai"] : [])],
      default: {},
    }),
    onPrompt: (input) => void prompts.push(input.body),
    seed: {
      storage: {
        "opencode.global.dat:model": {
          user: [
            { providerID: "console-openai", modelID: "gpt", visibility: "show" },
            { providerID: "openai", modelID: "direct-model", visibility: "show" },
          ],
        },
      },
    },
  })

  const control = page.locator('[data-action="composer-model"]')
  const picker = page.getByRole("dialog", { name: "Select model", exact: true })
  const selected = picker.locator('[data-option-key="console-openai:gpt"]')
  await expect(control).toHaveText("OpenAI / GPT")

  connected.direct = true
  await view.push([
    {
      id: "evt_direct_connected",
      created: T0 + 1,
      type: "provider.updated",
      location: { directory: view.directory },
      data: {},
    },
    {
      id: "evt_direct_models_connected",
      created: T0 + 2,
      type: "model.updated",
      location: { directory: view.directory },
      data: {},
    },
  ])
  await expect(control).toHaveText("OpenCode / OpenAI / GPT")
  await expect(control).toHaveAccessibleName("OpenCode / OpenAI / GPT")
  await control.click()
  const search = picker.getByRole("combobox", { name: "Search models", exact: true })
  await expect(picker.locator('[data-option-key="openai:direct-model"]')).toBeVisible()
  await search.fill("GPT")
  await expect(picker.locator('[data-option-key="openai:direct-model"]')).toHaveCount(0)
  await expect(selected).toHaveAttribute("aria-current", "true")
  await expect(control).toHaveText("OpenCode / OpenAI / GPT")
  await search.press("Escape")
  await expect(picker).toBeHidden()

  connected.direct = false
  await view.push([
    {
      id: "evt_direct_disconnected",
      created: T0 + 3,
      type: "provider.updated",
      location: { directory: view.directory },
      data: {},
    },
    {
      id: "evt_direct_models_disconnected",
      created: T0 + 4,
      type: "model.updated",
      location: { directory: view.directory },
      data: {},
    },
  ])
  await expect(control).toHaveText("OpenAI / GPT")

  await view.editor.fill("Keep the managed provider selected")
  await view.editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]).toMatchObject({ text: "Keep the managed provider selected" })
  expect(switches).toEqual([])
})

async function draft(page: Page) {
  const { editor } = await openDraft(page, { name: "ComposerDraft", provider: NO_PROVIDER })
  await editor.click()

  return editor
}

async function expectCaretVisible(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const selection = window.getSelection()

        if (!selection?.isCollapsed || !selection.rangeCount || !element.contains(selection.anchorNode)) return false
        const caret = selection.getRangeAt(0).getBoundingClientRect()
        const viewport = (element.closest("[data-scrollable]") ?? element).getBoundingClientRect()

        return caret.height > 0 && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1
      }),
    )
    .toBe(true)
}

test("keeps a 25000-line crash report editable in a new session", async ({ page }) => {
  const input = await draft(page)
  const text = "Thread 0 Crashed:\n" + "0   Example  0x0000000100000000 frame + 32\n".repeat(25000) + "End of report"
  await page.evaluate((text) => navigator.clipboard.writeText(text), text)

  const events = await input.evaluateHandle((element) => {
    const events = { count: 0 }
    element.addEventListener("input", () => events.count++)

    return events
  })

  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(async () => (await input.innerText()) === text).toBe(true)
  expect(await events.evaluate((events) => events.count)).toBe(1)
  await expect(input).toBeFocused()
  await expectCaretVisible(input)
  await page.keyboard.type("!")
  await expect.poll(async () => (await input.innerText()) === text + "!").toBe(true)
  await expectCaretVisible(input)
  await page.keyboard.press("ControlOrMeta+Home")
  await page.keyboard.press("ControlOrMeta+End")
  await expectCaretVisible(input)
})

test("keeps a line added at the end of a scrolling prompt clear of the bottom fade", async ({ page }) => {
  const { editor } = await openSession(page, { name: "ComposerFade" })
  await editor.click()

  for (const line of Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`)) {
    await page.keyboard.type(line)
    await page.keyboard.press("Shift+Enter")
  }

  await page.keyboard.type("Last line")
  await expect.poll(() => editor.innerText()).toMatch(/Line 12\nLast line$/)

  // The mask fades the viewport's bottom --composer-fade-bottom pixels; the last line must end above them.
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const viewport = element.closest('[data-component="composer-scroll"]')!
        const range = document.createRange()
        range.selectNodeContents(element)
        const line = Array.from(range.getClientRects()).reduce((last, rect) => (rect.bottom > last.bottom ? rect : last))
        const fade = parseFloat(getComputedStyle(viewport).getPropertyValue("--composer-fade-bottom"))

        return Math.max(0, Math.round(line.bottom - (viewport.getBoundingClientRect().bottom - fade)))
      }),
    )
    .toBe(0)
})

test("a key-up never moves the caret back after later navigation", async ({ page }) => {
  const input = await draft(page)
  await input.pressSequentially("first line")
  await expect(input).toHaveText("first line")

  // Navigation can land before the next frame; the cursor a key-up recorded must not overwrite it there.
  const offset = await input.evaluate(async (element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!
    const selection = window.getSelection()!
    selection.collapse(text, 0)
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }))
    selection.collapse(text, text.textContent!.length)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    return selection.anchorOffset
  })

  expect(offset).toBe("first line".length)
})

for (const [width, direction] of [
  [390, "rtl"],
  [1280, "ltr"],
] as const) {
  test(`reveals a multiline paste in the middle at ${width}px in ${direction}`, async ({ page }) => {
    const input = await draft(page)
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    const suffix = "\nExisting trailing content".repeat(100)
    await input.fill("Before " + suffix)
    await input.press("ControlOrMeta+Home")
    await input.press("ArrowRight")
    const text = "Pasted line /tmp/example.ts 123 \u0645\u0631\u062d\u0628\u0627\n".repeat(100) + "End of paste"
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    await expect.poll(() => input.innerText()).toBe("B" + text + "efore " + suffix)
    await expectCaretVisible(input)
    await page.keyboard.type("!")
    await expect.poll(() => input.innerText()).toBe("B" + text + "!efore " + suffix)
    await expectCaretVisible(input)
  })
}

test("pastes plain text without markup and keeps native undo", async ({ page }) => {
  const input = await draft(page)

  for (const text of [
    "single line <b> &amp;",
    "first\nsecond",
    "\n\n  indented\ttext  \n\nlast\n\n",
    'literal <b>bold</b> &amp; & < > "quotes"\n<script>not code</script>\n<img src="example">',
    "first\r\nsecond\rthird",
  ]) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    const expected = text.replace(/\r\n?/g, "\n")
    await expect.poll(() => input.innerText()).toBe(expected)
    await expect(input.locator("b, script, img")).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
    await page.keyboard.press("ControlOrMeta+Shift+Z")
    await expect.poll(() => input.innerText()).toBe(expected)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
  }
})

test("replaces only the selected text and leaves the caret after the paste", async ({ page }) => {
  const input = await draft(page)
  await page.evaluate(() => navigator.clipboard.writeText("one\ntwo"))
  await page.keyboard.type("before replace after")
  await expect(input).toHaveText("before replace after")
  await page.evaluate(() => document.fonts.ready)

  const word = await input.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 7)
    range.setEnd(element.firstChild!, 14)
    const rect = range.getBoundingClientRect()

    return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width }
  })

  await page.mouse.move(word.x, word.y)
  await page.mouse.down()
  await page.mouse.move(word.x + word.width, word.y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("replace")
  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.press("ControlOrMeta+Z")
  await expect(input).toHaveText("before replace after")
  await page.keyboard.press("ControlOrMeta+Shift+Z")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.type("!")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo! after")
})

test("shows the dropzone and attaches a dropped file", async ({ page }) => {
  const writes: { path: string; directory: string; body: string }[] = []
  await openDraft(page, {
    name: "ComposerDraft",
    provider: NO_PROVIDER,
    onFileWrite: (write) => void writes.push(write),
  })
  const surface = page.locator('[data-component="new-session"]')
  const dropzone = page.locator('[data-component="session-dropzone"]')

  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(["Dropzone fixture"], "dropzone.txt", { type: "text/plain" }))

    return value
  })

  await expect(dropzone).toHaveCount(0)
  await surface.dispatchEvent("dragover", { dataTransfer: transfer })
  await expect(dropzone).toHaveAttribute("data-visible", "true")
  await expect(dropzone).toContainText("Drop files to add")

  await surface.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
  await expect(dropzone).toHaveCount(0)
  // The file is uploaded to its own directory in the server's temporary directory, then attached by path.
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: expect.stringMatching(/\/uploads\/[0-9a-f-]{36}\/dropzone\.txt$/),
        directory: "C:/OpenCode/ComposerDraft",
        body: "Dropzone fixture",
      },
    ])
  await expect(page.locator('[data-component="upload-progress"]')).toHaveCount(0)
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
})

test("keeps a narrow session composer contained when invoking a built-in", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  const { editor } = await openSession(page, { name: "ComposerCommand", provider: NO_PROVIDER })
  const composer = page.locator('[data-component="composer"]')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await editor.fill("keep me")
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Commands" }).click()
  await page.locator('[data-suggestion-id="model.choose"]').click()

  const dialog = page.getByRole("dialog", { name: "Select model", exact: true })
  const search = dialog.getByRole("combobox", { name: "Search models", exact: true })
  await expect(search).toBeFocused()
  await expect(editor).toHaveText("keep me")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  await editor.fill("/model")
  await expect(page.locator('[data-suggestion-id="model.choose"]')).toHaveAttribute("data-active", "")
  await editor.press("Enter")
  await expect(search).toBeFocused()
  await expect(editor).toBeEmpty()
})

test("keeps focus in a dialog that replaces the model dialog and returns it to the composer caret", async ({
  page,
}) => {
  const { editor } = await openSession(page, {
    name: "ComposerDialogFocus",
    provider: provider({ id: "paid", name: "Paid", cost: { input: 1, output: 1 } }),
  })

  await editor.fill("keep me")
  await editor.press("End")
  await editor.press("ArrowLeft")
  await editor.press("ArrowLeft")
  await editor.press("ArrowLeft")
  // Clicking the trigger leaves focus at the caret, so the replacing dialog returns it there.
  await page.locator('[data-component="composer"] [data-action="composer-model"]').click()

  const models = page.getByRole("dialog", { name: "Select model", exact: true })
  await expect(models.getByRole("combobox", { name: "Search models", exact: true })).toBeFocused()
  await models.getByRole("button", { name: "Manage models", exact: true }).click()
  await expect(models).toBeHidden()

  const manage = page.getByRole("dialog", { name: "Manage models", exact: true })
  const search = manage.getByRole("searchbox", { name: "Search models", exact: true })
  await expect(search).toBeFocused()
  // Code behind the dialog that focuses the composer must not pull focus out of the open dialog.
  await editor.evaluate((element) => element.focus())
  await expect(search).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(manage).toBeHidden()
  await expect(editor).toBeFocused()
  await page.keyboard.type(",")
  await expect(editor).toHaveText("keep, me")
})

test("lists OpenCode's free models in the model picker however old they are", async ({ page }) => {
  await page.clock.setFixedTime(T0)
  const year = { released: T0 - 365 * 24 * 60 * 60 * 1000 }
  await openSession(page, {
    name: "ComposerFreeModels",
    provider: provider(
      { id: "new-paid", name: "New Paid", cost: { input: 1, output: 1 }, time: { released: T0 } },
      { id: "old-paid", name: "Old Paid", cost: { input: 1, output: 1 }, time: year },
      { id: "big-pickle", name: "Big Pickle", cost: { input: 0, output: 0 }, time: year },
    ),
  })

  await page.locator('[data-component="composer"] [data-action="composer-model"]').click()
  const models = page.getByRole("dialog", { name: "Select model", exact: true })
  await expect(models.locator('[data-option-key="opencode:new-paid"]')).toBeVisible()
  await expect(models.locator('[data-option-key="opencode:big-pickle"]')).toBeVisible()
  await expect(models.locator('[data-option-key="opencode:old-paid"]')).toHaveCount(0)
})

test("lists slash commands in their built-in order", async ({ page }) => {
  const { editor } = await openSession(page, {
    name: "ComposerSlash",
    provider: NO_PROVIDER,
    commands: [
      { name: "init", description: "Create AGENTS.md" },
      { name: "review", description: "Review changes" },
    ],
    // A sent message enables /undo, /compact and /fork.
    pageMessages: () => ({ items: [{ id: "msg_slash", type: "user", text: "Hello", time: { created: T0 } }] }),
  })

  await editor.fill("/")
  await expect(page.locator('[data-component="composer-suggestions"] [data-suggestion-id] bdi')).toHaveText([
    "/init",
    "/review",
    "/new",
    "/undo",
    "/compact",
    "/fork",
    "/export",
    "/open",
    "/terminal",
    "/mcp",
    "/model",
    "/connect",
    "/reload",
    "/btw",
  ])
})

test("/reload reloads the server's configuration once and reports it", async ({ page }) => {
  const { editor } = await openSession(page, { name: "ComposerReload", provider: NO_PROVIDER })
  const reloaded = Promise.withResolvers<void>()
  let reloads = 0
  await page.route(/\/api\/location\/reload$/, async (route) => {
    reloads++
    await reloaded.promise
    await route.fulfill({ status: 204 })
  })

  await editor.fill("/reload")
  await expect(page.locator('[data-suggestion-id="config.reload"]')).toHaveAttribute("data-active", "")
  await editor.press("Enter")
  await expect(page.getByText("Reloading configuration…", { exact: true })).toBeVisible()
  reloaded.resolve()
  await expect(page.getByText("Configuration reloaded", { exact: true })).toBeVisible()
  await expect(page.getByText("Reloading configuration…", { exact: true })).toBeHidden()
  await expect(editor).toBeEmpty()
  expect(reloads).toBe(1)
})

const followUp = "Add follow-up, / for commands, @ for context…"

for (const row of [
  { state: "an idle", copy: "Ask anything, / for commands, @ for context…" },
  { state: "a running", copy: followUp, sessionStatus: { ses_placeholder: { type: "running" } } },
  {
    state: "an idle queued",
    copy: followUp,
    inbox: [
      {
        id: "inb_placeholder",
        sessionID: "ses_placeholder",
        time: { created: T0 },
        type: "user",
        payload: { text: "Queued follow-up" },
        delivery: "queue",
      },
    ],
  },
]) {
  test(`shows the placeholder for ${row.state} session and the shell example in shell mode`, async ({ page }) => {
    const { editor } = await openSession(page, {
      name: "ComposerPlaceholder",
      sessions: [{ id: "ses_placeholder", title: "Placeholder" }],
      sessionStatus: row.sessionStatus,
      inbox: row.inbox,
    })

    const scroll = page.locator('[data-component="composer-scroll"]')
    await expect(scroll).toHaveText(row.copy)
    await editor.pressSequentially("!")
    await expect(scroll).toHaveText("Enter shell command… git status")
  })
}

test("marks a Console provider with its workspace only when it is also connected directly", async ({ page }) => {
  const model = (id: string, name: string) => ({ [id]: { id, name, limit: { context: 200_000 } } })

  const managed = (id: string, canonical: string, name: string, models: ReturnType<typeof model>) => ({
    id,
    canonical,
    integrationID: "opencode",
    name: `Anomaly / ${name}`,
    models,
  })

  await openSession(page, {
    name: "ComposerConsoleProviders",
    provider: {
      all: [
        managed("opencode", "opencode", "OpenCode", model("console-model", "Console Model")),
        managed("console-google", "google", "Google", model("managed-gemini", "Managed Gemini")),
        managed("console-openai", "openai", "OpenAI", model("managed-gpt", "Managed GPT")),
        { id: "google", canonical: "google", name: "Google", models: model("direct-gemini", "Direct Gemini") },
      ],
      connected: ["opencode", "console-google", "console-openai", "google"],
      default: { providerID: "opencode", modelID: "console-model" },
    },
    seed: {
      storage: {
        "opencode.global.dat:model": {
          user: [
            ["opencode", "console-model"],
            ["console-google", "managed-gemini"],
            ["console-openai", "managed-gpt"],
            ["google", "direct-gemini"],
          ].map(([providerID, modelID]) => ({ providerID, modelID, visibility: "show" })),
          recent: [],
          variant: {},
        },
      },
    },
  })

  const trigger = page.locator('[data-component="composer"] [data-action="composer-model"]')
  await trigger.click()
  const menu = page.getByRole("dialog", { name: "Select model", exact: true })
  await expect(menu.getByRole("option", { name: "Direct Gemini", exact: true })).toBeVisible()
  const headings = menu.locator('[data-slot="search-list-header"]')
  await expect(headings).toHaveCount(4)
  await expect(headings.filter({ hasText: /^GoogleAnomaly$/ })).toHaveCount(1)
  await expect(headings.filter({ hasText: /^Google$/ })).toHaveCount(1)
  await expect(headings.filter({ hasText: /^OpenAI$/ })).toHaveCount(1)
  await expect(headings.filter({ hasText: /^OpenCode$/ })).toHaveCount(1)
  await expect(menu.getByText(/Anomaly \//)).toHaveCount(0)
})

test("shows thinking on hover or a non-default selection while preserving keyboard access", async ({ page }) => {
  const { editor: input } = await openSession(page, {
    name: "ComposerThinking",
    provider: provider({ id: "thinking-model", name: "Thinking Model", variants: { high: {} } }),
  })

  const composer = page.locator('[data-component="composer"]')
  const control = composer.getByRole("button", { name: "Choose model variant" })
  const option = (name: string) => page.getByRole("menuitemradio", { name, exact: true })

  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")
  await expect(control).toHaveCSS("pointer-events", "none")

  await input.hover()
  await expect(control).toHaveCSS("opacity", "1")

  // The menu keeps the control visible after the pointer leaves.
  await control.click()
  await expect(option("high")).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toHaveAttribute("aria-expanded", "true")
  await expect(control).toHaveCSS("opacity", "1")
  await option("high").click()

  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("high")
  await expect(control).toHaveCSS("opacity", "1")

  await control.click()
  await option("default").click()
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")

  // The single-agent fixture has only Add and Model before the thinking trigger.
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Add images and files" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Thinking Model" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Enter")
  await expect(option("default")).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Escape")
  await expect(control).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toHaveCSS("opacity", "0")
})

test("pastes into the composer from the session view but not into other inputs", async ({ page }) => {
  const prompts: unknown[] = []
  const { editor } = await openSession(page, { name: "PasteFocus", onPrompt: (input) => void prompts.push(input.body) })
  await editor.fill("hello")
  await editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  const message = page.locator('[data-timeline-row="UserMessage"]')
  await message.click()
  await expect(editor).not.toBeFocused()

  await page.evaluate(() => navigator.clipboard.writeText("pasted from the timeline"))
  await page.keyboard.press("ControlOrMeta+V")
  await expect(editor).toBeFocused()
  await expect.poll(() => editor.innerText()).toBe("pasted from the timeline")

  await editor.blur()
  await page.evaluate(() => {
    const field = document.createElement("input")
    field.id = "elsewhere"
    document.body.append(field)
    field.focus()
  })
  await page.keyboard.press("ControlOrMeta+V")
  await expect(page.locator("#elsewhere")).toHaveValue("pasted from the timeline")
  await expect(page.locator("#elsewhere")).toBeFocused()
  await expect.poll(() => editor.innerText()).toBe("pasted from the timeline")
})
