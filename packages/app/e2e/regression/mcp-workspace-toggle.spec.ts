import { expect, test, type Page } from "@playwright/test"
import { holdRoute, NO_PROVIDER, sessionHref } from "../utils/app"
import type { MockServerConfig } from "../utils/mock-server"
import { mockWorkspace } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:\\OpenCode\\main"

const workspace = "C:\\OpenCode\\worktree"

const sessionID = "ses_mcp_workspace"

const title = "Workspace MCP routing"

type Surface = "popover" | "dialog" | "settings"

// A session in a worktree of the project. The harness answers the MCP list for each location directory and stores
// connect/disconnect results per directory; `requests` records every MCP request and the directory it targeted.
// The popover is the session details' MCP list; the dialog (Ctrl+;) is the app's own MCP manager; settings is the
// Extensions page opened (Ctrl+,) from the session.
async function open(
  page: Page,
  input: { surface: Surface } & Pick<MockServerConfig, "mcp" | "onMcpAction" | "integrations" | "onIntegrationOAuth">,
) {
  const requests: { path: string; directory: string }[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())

    if (request.method() === "OPTIONS" || !/^\/api\/(?:experimental\/)?mcp(?:\/|$)/.test(url.pathname)) return
    requests.push({ path: url.pathname, directory: url.searchParams.get("location[directory]") || directory })
  })

  const mock = await mockWorkspace(page, {
    name: "mcp-workspace",
    directory,
    project: { sandboxes: [workspace] },
    provider: NO_PROVIDER,
    sessions: [{ id: sessionID, title, directory: workspace }],
    seed: { settings: { keybinds: { "mcp.toggle": "ctrl+;" } } },
    mcp: input.mcp,
    onMcpAction: input.onMcpAction,
    integrations: input.integrations,
    onIntegrationOAuth: input.onIntegrationOAuth,
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()

  const panel = {
    settings: page.getByTestId("settings-screen"),
    popover: page.getByRole("group", { name: "MCP", exact: true }),
    dialog: page.getByRole("dialog", { name: "MCPs", exact: true }),
  }[input.surface]

  const show = async () => {
    if (input.surface === "dialog") return page.keyboard.press("Control+;")

    if (input.surface === "settings") {
      await page.keyboard.press("Control+,")

      return panel.getByRole("tab", { name: "Extensions", exact: true }).click()
    }

    await page.getByRole("button", { name: "Session details", exact: true }).click()
    const item = page.getByRole("button", { name: "MCP", exact: true })
    await item.click()
    await expect(panel).toBeVisible()
  }

  await show()
  // The settings row also names its switch with a visually hidden label.
  await expect(
    input.surface === "settings"
      ? panel.getByRole("switch", { name: "figma-desktop", exact: true })
      : panel.locator('[data-slot="truncated-text-label"]').filter({ hasText: "figma-desktop" }),
  ).toBeVisible()

  return { requests, panel, show, push: mock.push, toggle: panel.getByRole("switch") }
}

test("settings shows and toggles the MCP of the session it was opened from", async ({ page }) => {
  const actions: Parameters<NonNullable<MockServerConfig["onMcpAction"]>>[0][] = []

  const view = await open(page, {
    surface: "settings",
    mcp: (target) => [{ name: "figma-desktop", status: { status: target === workspace ? "connected" : "disabled" } }],
    onMcpAction: (action) => void actions.push(action),
  })

  await expect(view.toggle).toBeChecked()
  await expect(view.toggle).toBeEnabled()
  view.requests.length = 0

  await view.panel.locator('[data-slot="switch-control"]').click()
  await expect(view.toggle).not.toBeChecked()
  await expect(view.toggle).toBeEnabled()
  expect(actions).toEqual([{ server: "figma-desktop", action: "disconnect", directory: workspace }])
  expect(view.requests).toContainEqual({ path: "/api/experimental/mcp/figma-desktop/disconnect", directory: workspace })
})

for (const surface of ["popover", "dialog"] as const) {
  for (const shared of [true, false]) {
    test(`toggles the workspace MCP from the ${surface} when the default location ${shared ? "has" : "does not have"} the server`, async ({
      page,
    }) => {
      const actions: Parameters<NonNullable<MockServerConfig["onMcpAction"]>>[0][] = []

      const view = await open(page, {
        surface,
        mcp: (target) =>
          !shared && target !== workspace ? [] : [{ name: "figma-desktop", status: { status: "disabled" } }],
        onMcpAction: (action) => void actions.push(action),
      })

      await expect(view.toggle).not.toBeChecked()
      await expect(view.toggle).toBeEnabled()
      view.requests.length = 0

      await view.panel.locator('[data-slot="switch-control"]').click()
      await expect(view.toggle).toBeChecked()
      await expect(view.toggle).toBeEnabled()
      expect(actions).toEqual([{ server: "figma-desktop", action: "connect", directory: workspace }])
      expect(view.requests).toContainEqual({
        path: "/api/experimental/mcp/figma-desktop/connect",
        directory: workspace,
      })
      expect(view.requests).toContainEqual({ path: "/api/mcp/resource", directory: workspace })
      expect(view.requests.every((request) => request.directory === workspace)).toBe(true)

      view.requests.length = 0
      await view.panel.locator('[data-slot="switch-control"]').click()
      await expect(view.toggle).not.toBeChecked()
      await expect(view.toggle).toBeEnabled()
      expect(actions).toEqual([
        { server: "figma-desktop", action: "connect", directory: workspace },
        { server: "figma-desktop", action: "disconnect", directory: workspace },
      ])
      expect(view.requests).toContainEqual({
        path: "/api/experimental/mcp/figma-desktop/disconnect",
        directory: workspace,
      })
      expect(view.requests.every((request) => request.directory === workspace)).toBe(true)
    })
  }
}

test("the MCP popover shows a failed server and reconnects it from its details", async ({ page }) => {
  const error = "Streamable HTTP error: Error POSTing to endpoint: 404 Not Found"

  const view = await open(page, {
    surface: "popover",
    mcp: (target) => [
      { name: "figma-desktop", status: target !== workspace ? { status: "connected" } : { status: "failed", error } },
    ],
  })

  const row = view.panel.locator(".session-mcp-row").filter({ hasText: "figma-desktop" })
  // The red dot is the status, and opens the error.
  await expect(view.toggle).toHaveAccessibleDescription("Failed")
  const failed = row.getByRole("button", { name: "Details for figma-desktop", exact: true })
  view.requests.length = 0
  await failed.click()
  const details = page.getByRole("dialog", { name: "figma-desktop", exact: true })
  await expect(details).toHaveAccessibleDescription("Connection failed")
  await expect(details.getByText(error, { exact: true })).toBeVisible()
  await details.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(details).toBeHidden()
  expect(view.requests.filter((request) => request.path.endsWith("/connect"))).toEqual([
    { path: "/api/experimental/mcp/figma-desktop/connect", directory: workspace },
  ])

  if (!(await view.panel.isVisible())) await view.show()
  await expect(view.toggle).toHaveAccessibleDescription("Connected")
})

for (const surface of ["dialog"] as const) {
  test(`shows connection failures from the MCP ${surface} and allows reconnecting`, async ({ page }) => {
    const error = "Streamable HTTP error: Error POSTing to endpoint: 404 Not Found"
    const state = { fail: true }

    const view = await open(page, {
      surface,
      mcp: (target) => [
        { name: "figma-desktop", status: { status: target !== workspace ? "connected" : "disabled", error } },
      ],
      // Connection failures are reported by the refreshed status, not the HTTP response.
      onMcpAction: (input) => (input.action === "connect" && state.fail ? { status: "failed", error } : undefined),
    })

    // The dialog opens with its search focused and the first server highlighted.
    if (surface === "dialog") {
      await expect(view.panel.getByRole("combobox", { name: "Search MCPs", exact: true })).toBeFocused()
      await expect(view.panel.getByRole("option")).toHaveAttribute("aria-selected", "true")
    }

    await expect(view.toggle).not.toBeChecked()
    await expect(view.toggle).toBeEnabled()
    view.requests.length = 0

    await view.panel.locator('[data-slot="switch-control"]').click()

    const toast = page
      .getByRole("listitem", { includeHidden: true })
      .filter({ has: page.getByText("Request failed", { exact: true }) })

    await expect(toast.getByText(`figma-desktop: ${error}`, { exact: true })).toBeVisible()
    expect(view.requests.filter((request) => request.path.endsWith("/connect"))).toEqual([
      { path: "/api/experimental/mcp/figma-desktop/connect", directory: workspace },
    ])
    expect(view.requests.every((request) => request.directory === workspace)).toBe(true)

    // The red dot is the status and the switch stays on; a ghost action beside it opens the error.
    const failed = view.panel.getByRole("button", { name: "View error for figma-desktop", exact: true })
    const details = page.getByRole("dialog", { name: "figma-desktop", exact: true })
    await expect(view.toggle).toBeChecked()
    await expect(view.toggle).toHaveAccessibleDescription("Failed")
    await expect(failed).toHaveText("View error")
    await expect(failed).toHaveAttribute("data-variant", "ghost-muted")
    await failed.click()
    await expect(details).toHaveAccessibleDescription("Connection failed")
    await expect(details.getByText(error, { exact: true })).toBeVisible()

    if (surface === "dialog") {
      const back = details.getByRole("button", { name: "Navigate back", exact: true })

      await expect
        .poll(async () => {
          const navigation = await back.boundingBox()
          const heading = await details.getByRole("heading", { name: "figma-desktop", exact: true }).boundingBox()
          const error = await details.locator('[data-slot="error-details-text"]').boundingBox()
          const status = await details.getByText("Connection failed", { exact: true }).boundingBox()

          return (
            !!navigation &&
            !!heading &&
            !!error &&
            !!status &&
            Math.abs(heading.y - navigation.y) < 1 &&
            heading.x >= navigation.x + navigation.width &&
            Math.abs(status.x - error.x) < 1
          )
        })
        .toBe(true)
      await back.click()
      await expect(failed).toBeVisible()
      await failed.click()
    }

    state.fail = false
    await details.getByRole("button", { name: "Try again", exact: true }).click()
    await expect(view.toggle).toBeChecked()
    await expect(view.toggle).toBeEnabled()
  })
}

test("the MCP list shrinks with matches and keeps its search anchored while scrolling", async ({ page }) => {
  const view = await open(page, {
    surface: "dialog",
    mcp: ["figma-desktop", ...Array.from({ length: 24 }, (_, index) => `server-${String(index).padStart(2, "0")}`)].map(
      (name) => ({ name, status: { status: "disabled" } }),
    ),
  })

  const input = view.panel.getByRole("combobox", { name: "Search MCPs", exact: true })
  const container = page.locator('[data-component="dialog-v2"] [data-slot="dialog-container"]')

  const geometry = () =>
    container.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      inputTop: element.querySelector('[role="combobox"]')!.getBoundingClientRect().top,
    }))

  await expect(input).toBeFocused()
  await expect(view.panel.getByRole("option")).toHaveCount(25)
  await input.hover()
  const initial = await geometry()

  await input.fill("figma-desktop")
  await expect(view.panel.getByRole("option")).toHaveCount(1)
  await expect.poll(async () => (await geometry()).height).toBeLessThan(initial.height - 100)
  await expect.poll(async () => (await geometry()).inputTop).toBeCloseTo(initial.inputTop, 0)

  await input.clear()
  await expect(view.panel.getByRole("option")).toHaveCount(25)
  const scroll = view.panel.locator('[data-slot="search-list-scroll"]')

  await expect.poll(() => scroll.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
  await expect.poll(async () => (await geometry()).height).toBeLessThanOrEqual(480)
  await input.press("End")
  const last = view.panel.getByRole("option", { name: "server-23", exact: true })

  await expect(last).toHaveAttribute("aria-selected", "true")
  await expect(last).toBeInViewport()
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect.poll(async () => (await geometry()).inputTop).toBeCloseTo(initial.inputTop, 0)
  await expect(input).toBeFocused()
})

test("toggling an MCP from the dialog keeps it highlighted", async ({ page }) => {
  const connected = new Set<string>()
  const names = ["alpha-mcp", "figma-desktop", "zeta-mcp"]

  const view = await open(page, {
    surface: "dialog",
    mcp: () => names.map((name) => ({ name, status: { status: connected.has(name) ? "connected" : "disabled" } })),
    onMcpAction: (input) =>
      void (input.action === "connect" ? connected.add(input.server) : connected.delete(input.server)),
  })

  const row = view.panel.getByRole("option").filter({ hasText: "figma-desktop" })
  const toggle = row.getByRole("switch", { name: "figma-desktop", exact: true })

  // From the keyboard, Enter toggles the highlighted server and the highlight stays on it.
  await page.keyboard.press("ArrowDown")
  await expect(row).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")
  await expect(toggle).toBeChecked()
  await expect(row).toHaveAttribute("aria-selected", "true")

  // With the pointer, the switch toggles the row under it and the highlight stays there too.
  await row.locator('[data-slot="switch-control"]').click()
  await expect(toggle).not.toBeChecked()
  await expect(toggle).toBeEnabled()
  await expect(row).toHaveAttribute("aria-selected", "true")
})

for (const surface of ["popover", "dialog"] as const) {
  test(`signs in to an auth-gated MCP from the ${surface}`, async ({ page, context }) => {
    const state = { signedIn: false }
    const attempts: string[] = []
    await context.route("https://auth.example.test/**", (route) => route.fulfill({ body: "Sign in" }))

    const view = await open(page, {
      surface,
      mcp: () => [
        {
          name: "figma-desktop",
          integrationID: "figma-oauth",
          status: state.signedIn ? { status: "connected" } : { status: "needs_auth", error: "Sign in required" },
        },
      ],
      integrations: [{ id: "figma-oauth", name: "Figma", methods: [{ id: "oauth", type: "oauth" }], connections: [] }],
      onIntegrationOAuth: (input) => {
        attempts.push(input.directory)

        return { url: "https://auth.example.test/authorize" }
      },
    })

    // The switch would only start sign-in, so both surfaces offer that action in its place.
    await expect(view.toggle).toHaveCount(0)
    await expect(view.panel.getByText("Sign in required", { exact: true })).toHaveCount(0)
    const popup = page.waitForEvent("popup")
    const signIn = view.panel.getByRole("button", { name: "Sign in to figma-desktop", exact: true })

    const authorization = await holdRoute(page, /\/api\/integration\/figma-oauth\/connect\/oauth(?:\?|$)/, {
      method: "POST",
    })

    await expect(signIn).toHaveAttribute("data-component", "button-v2")
    await expect(signIn).toHaveAttribute("data-variant", "ghost-muted")
    await expect(signIn.locator("svg")).toHaveCount(0)
    await signIn.click()
    await expect(signIn).toHaveText("Signing in…")
    await expect(signIn).toBeDisabled()
    await authorization.arrived
    authorization.release()
    await expect(await popup).toHaveURL("https://auth.example.test/authorize")
    expect(attempts).toEqual([workspace])

    // Completing sign-in reconnects the server, which reports the change.
    state.signedIn = true
    await view.push([
      {
        id: "evt_mcp_signed_in",
        created: 1,
        type: "mcp.status.changed",
        location: { directory: workspace },
        data: { server: "figma-desktop" },
      },
    ])

    if (!(await view.panel.isVisible())) await view.show()

    if (surface === "dialog") await expect(view.toggle).toBeChecked()
    else
      await expect(view.panel.getByRole("switch", { name: "figma-desktop", exact: true })).toHaveAccessibleDescription(
        "Connected",
      )
    await expect(view.panel.getByRole("button", { name: "Sign in to figma-desktop", exact: true })).toHaveCount(0)
  })
}

for (const surface of ["popover", "dialog"] as const) {
  test(`long MCP names keep their status and controls visible in the ${surface}`, async ({ page }) => {
    const names = ["connected", "disabled", "failed", "needs_auth"].map(
      (status) => `long-${status}-mcp-server-for-the-internal-knowledge-base-search`,
    )

    const actions: string[] = []

    const view = await open(page, {
      surface,
      mcp: [
        { name: "figma-desktop", status: { status: "disabled" } },
        ...names.map((name, index) => ({
          name,
          integrationID: index === 3 ? "long-oauth" : undefined,
          status: { status: ["connected", "disabled", "failed", "needs_auth"][index], error: "Connection refused" },
        })),
      ],
      onMcpAction: (input) => void actions.push(input.server),
    })

    for (const [index, name] of names.entries()) {
      const row = view.panel
        .locator(surface === "dialog" ? '[role="option"]' : ".session-mcp-row")
        .filter({ hasText: name })

      // The dot is the status, so the control beside the name must stay whole.
      const status =
        index === 3
          ? row.getByText(["Connected", "Disabled", "Failed", "Sign in"][index], { exact: true })
          : row.locator('[data-slot="switch-control"]')

      await expect(status).toBeVisible()
      await expect
        .poll(() => status.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width > 0))
        .toBe(true)
    }

    const name = view.panel.locator('[data-slot="truncated-text-label"]').filter({ hasText: names[0] })
    await name.hover()
    // The modal aria-hides body portals; the full name remains the trigger's accessible text.
    const tooltip = page.getByRole("tooltip", { includeHidden: true })
    await expect(tooltip).toHaveText(names[0])
    await expect(tooltip).toBeVisible()
    await page.mouse.move(0, 0)
    await view.panel.locator(".truncated-text").filter({ hasText: names[0] }).focus()
    await expect(tooltip).toHaveText(names[0])
    expect(actions).toEqual([])
    await view.panel.locator(".truncated-text").filter({ hasText: names[0] }).blur()
    await view.panel.locator('[data-slot="truncated-text-label"]').filter({ hasText: "figma-desktop" }).hover()
    await expect(tooltip).toBeHidden()

    if (surface !== "dialog") return
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(name).toHaveCSS("white-space", "normal")
    await expect.poll(() => name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await view.panel.getByRole("button", { name: `View error for ${names[2]}`, exact: true }).scrollIntoViewIfNeeded()
    await expect(view.panel.getByRole("button", { name: `View error for ${names[2]}`, exact: true })).toBeInViewport()
  })
}
