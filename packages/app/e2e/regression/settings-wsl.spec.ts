import { base64Encode } from "@opencode/util/encode"
import { expect, test, type Locator } from "@playwright/test"
import { NO_PROVIDER, REMOTE_SERVER, SERVER, holdRoute, project, provider, session } from "../utils/app"
import { mockOpenCodeServer, mockServers } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

test.use({ viewport: { width: 1280, height: 900 } })

test("WSL distribution radios stay inset and aligned in both add-server lists", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: "/repo",
    project: project({ id: "proj_wsl_alignment", directory: "/repo", name: "WSL project" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({
      server: SERVER,
      mode: "ready",
      distros: "Ubuntu-24.04,AlmaLinux-9,Debian-WSL1",
    })}`,
  )
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Servers", exact: true }).click()
  await expect(settings.getByRole("region", { name: "Ubuntu", exact: true })).toHaveCount(1)
  await settings.getByRole("button", { name: "Add server", exact: true }).press("Enter")
  await page.getByRole("menuitem", { name: "Add WSL server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const ubuntu = dialog.getByRole("radio", { name: "Ubuntu-24.04 OpenCode not installed", exact: true })
  const alma = dialog.getByRole("radio", { name: "AlmaLinux-9 OpenCode not installed", exact: true })
  await expect(ubuntu).toBeEnabled()
  await expect(dialog.getByText("OpenCode not installed", { exact: true })).toHaveCount(2)
  await expect(dialog.getByRole("radio", { name: "Debian-WSL1 Unsupported · Use WSL 2", exact: true })).toBeDisabled()
  await expectDistroLayout(dialog)
  await dialog
    .locator('[data-slot="radio-v2-item-label"]')
    .filter({ has: page.getByText("AlmaLinux-9", { exact: true }) })
    .click()
  await expect(alma).toBeChecked()
  await alma.press("ArrowUp")
  await expect(ubuntu).toBeChecked()
  await expect(ubuntu).toBeFocused()
  await expectDistroLayout(dialog)

  await dialog.getByRole("button", { name: /Need another distro/ }).click()
  await expect(dialog.getByRole("heading", { name: "Install distro", exact: true })).toBeVisible()
  await expect(dialog.getByRole("radio", { name: "Debian", exact: true })).toBeChecked()
  await expectDistroLayout(dialog)
  await dialog
    .locator('[data-slot="radio-v2-item-label"]')
    .filter({ has: page.getByText("FedoraLinux-43", { exact: true }) })
    .click()
  await expect(dialog.getByRole("radio", { name: "FedoraLinux-43", exact: true })).toBeChecked()
  await expectDistroLayout(dialog)
})

async function expectDistroLayout(dialog: Locator) {
  // Keep the visible control inside its row and aligned with its label, including disabled rows,
  // and keep rows flush so every divider sits the same distance from the content below it.
  await expect
    .poll(() =>
      dialog.locator(".settings-wsl-distro-row").evaluateAll((rows) =>
        rows.every((row, index) => {
          const previous = rows[index - 1]?.getBoundingClientRect()

          if (previous && Math.abs(row.getBoundingClientRect().top - previous.bottom) > 1) return false
          const control = row.querySelector('[data-slot="radio-v2-item-control"]')
          const label = row.querySelector('[data-slot="radio-v2-item-label-text"]')

          if (!control || !label) return false
          const bounds = row.getBoundingClientRect()
          const circle = control.getBoundingClientRect()
          const text = label.getBoundingClientRect()

          return (
            circle.left - bounds.left >= 8 &&
            circle.top - bounds.top >= 8 &&
            circle.bottom < bounds.bottom &&
            circle.right < text.left &&
            Math.abs(circle.top + circle.height / 2 - (text.top + text.height / 2)) <= 4
          )
        }),
      ),
    )
    .toBe(true)
}

for (const mode of ["failed", "stopped", "ready"] as const) {
  test(`manages a ${mode} configured WSL server from the Servers page`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory: "/repo",
      project: project({ id: "proj_wsl_settings", directory: "/repo", name: "WSL project" }),
      provider: NO_PROVIDER,
      sessions: [],
      pageMessages: () => ({ items: [] }),
    })
    await page.goto(`/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode })}`)
    const settings = page.getByTestId("settings-screen")
    const switcher = settings.getByRole("button", { name: /^Server / })
    await settings.getByRole("tab", { name: "Projects", exact: true }).click()
    await switcher.click()
    await page.getByRole("menuitemradio", { name: /^Ubuntu/ }).click()
    const unavailable = settings.getByRole("status").filter({ hasText: "Can't reach Ubuntu" })

    if (mode !== "ready") await expect(unavailable).toBeVisible()

    await settings.getByRole("tab", { name: "Servers", exact: true }).click()
    const connection = settings.getByRole("region", { name: "Ubuntu", exact: true })

    if (mode !== "ready") {
      await connection.getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menuitem", { name: "Retry start", exact: true }).click()
      await expect(page.getByLabel("WSL actions")).toHaveText("start:wsl:Ubuntu")
    }

    await settings.getByRole("tab", { name: "Projects", exact: true }).click()
    await expect(switcher).toHaveText("ServerUbuntu")
    await expect(unavailable).toHaveCount(0)
    await settings.getByRole("tab", { name: "Servers", exact: true }).click()
    await connection.getByRole("button", { name: "Update OpenCode", exact: true }).click()
    await expect(page.getByLabel("WSL actions")).toContainText("update:Ubuntu")
    await expect(connection.getByRole("button", { name: "Update OpenCode", exact: true })).toHaveCount(0)

    await connection.getByRole("button", { name: "More options", exact: true }).click()
    await page.getByRole("menuitem", { name: "Remove", exact: true }).click()
    await expect(page.getByLabel("WSL actions")).toContainText("remove:wsl:Ubuntu")
    await expect(connection).toHaveCount(0)
    await expect(settings.getByRole("tab", { name: "Server", exact: true })).toBeEnabled()
  })
}

test("adding a WSL server while the WSL plugin is down shows that WSL is unavailable", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: "/repo",
    project: project({ id: "proj_wsl_unavailable", directory: "/repo", name: "WSL project" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto(`/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready" })}`)
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Servers", exact: true }).click()
  await expect(settings.getByRole("region", { name: "Ubuntu", exact: true })).toHaveCount(1)
  await page.getByRole("checkbox", { name: "WSL plugin" }).uncheck()

  await settings.getByRole("button", { name: "Add server", exact: true }).press("Enter")
  await page.getByRole("menuitem", { name: "Add WSL server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "WSL unavailable", exact: true })).toBeVisible()
  await expect(dialog.getByText("OpenCode could not verify WSL on this machine.", { exact: true })).toBeVisible()
  await expect(dialog.getByText("WSL is unavailable", { exact: true })).toBeVisible()
})

test("adding an SSH server while the SSH plugin is down fails instead of connecting forever", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: "/repo",
    project: project({ id: "proj_ssh_unavailable", directory: "/repo", name: "SSH project" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto(`/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready" })}`)
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Servers", exact: true }).click()
  await expect(settings.getByRole("region", { name: "Ubuntu", exact: true })).toHaveCount(1)
  await page.getByRole("checkbox", { name: "SSH plugin" }).uncheck()

  await settings.getByRole("button", { name: "Add server", exact: true }).press("Enter")
  await page.getByRole("menuitem", { name: "Add SSH server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Host or SSH command" }).fill("ssh devbox")
  await dialog.getByRole("button", { name: "Add server", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Request failed")
  await expect(dialog.getByRole("button", { name: "Add server", exact: true })).toBeEnabled()
})

test("WSL session and draft tabs outlive the plugin going away until the server is removed", async ({ page }) => {
  const directory = "/home/ubuntu/project"
  const wsl = session({ id: "ses_wsl_tabs", directory, title: "WSL tabs session" })

  const config = {
    directory,
    project: project({ id: "proj_wsl_tabs", directory }),
    provider: NO_PROVIDER,
    sessions: [wsl],
    pageMessages: () => ({ items: [] }),
  }

  await mockServers(page, { [SERVER]: { ...config, sessions: [] }, [REMOTE_SERVER]: config })
  const href = `/server/${base64Encode("wsl:Ubuntu")}/session/${wsl.id}`
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready", wsl: REMOTE_SERVER, path: href })}`,
  )
  await expectSessionTitle(page, wsl.title)
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(page.getByRole("heading", { name: wsl.title })).toHaveCount(0)
  const editor = page.locator('[data-component="composer-editor"]')
  await editor.fill("keep this draft")
  await expect(editor).toHaveText("keep this draft")
  const tabs = page.locator("a[data-titlebar-tab-link]")

  const expectTabs = async () => {
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(0)).toHaveAttribute("href", href)
    await expect(tabs.nth(1)).toHaveAttribute("href", /^\/new-session\?draftId=/)
  }

  await expectTabs()

  const plugin = page.getByRole("checkbox", { name: "WSL plugin" })
  await plugin.uncheck()
  await expectTabs()
  await expect(editor).toHaveText("keep this draft")
  await plugin.check()
  await expectTabs()
  await tabs.nth(0).click()
  await expectSessionTitle(page, wsl.title)

  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Servers", exact: true }).click()
  const connection = settings.getByRole("region", { name: "Ubuntu", exact: true })
  await connection.getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click()
  await expect(page.getByLabel("WSL actions")).toHaveText("remove:wsl:Ubuntu")
  await expect(tabs).toHaveCount(0)
})

test("an SSH host that asks for sign-in again opens the dialog once per selected tab", async ({ page }) => {
  const directory = "/home/box/project"
  const box = session({ id: "ses_ssh_offer", directory, title: "SSH offer session" })

  const config = {
    directory,
    project: project({ id: "proj_ssh_offer", directory }),
    provider: provider(),
    sessions: [box],
    pageMessages: () => ({ items: [] }),
  }

  await mockServers(page, { [SERVER]: { ...config, sessions: [] }, [REMOTE_SERVER]: config })
  const path = `/server/${base64Encode("ssh:box")}/session/${box.id}`
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready", ssh: REMOTE_SERVER, path })}`,
  )
  await expectSessionTitle(page, box.title)
  const connects = page.getByLabel("SSH connects")
  const signIn = page.getByRole("button", { name: "Require SSH sign-in" })
  const authenticate = page.getByRole("button", { name: "Authenticate", exact: true })

  // The first request on the tab opens sign-in by itself; the fixture's host connects without a prompt.
  await signIn.click()
  await expect(connects).toHaveText("1")
  await expectSessionTitle(page, box.title)
  // A later request on the same tab only offers the button.
  await signIn.click()
  await expect(authenticate).toBeVisible()
  await expect(connects).toHaveText("1")
  await authenticate.click()
  await expect(connects).toHaveText("2")
  await expectSessionTitle(page, box.title)

  // Another tab selected and this one selected again is a new selection, even while the host was ready.
  const tabs = page.locator("a[data-titlebar-tab-link]")
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute("href", /^\/new-session\?draftId=/)
  await expect(page.getByRole("heading", { name: box.title })).toHaveCount(0)
  await tabs.nth(0).click()
  await expectSessionTitle(page, box.title)
  await signIn.click()
  await expect(connects).toHaveText("3")
})

test("an open session moves to the controller a new SSH sign-in creates", async ({ page }) => {
  const directory = "/home/box/project"
  const model = { id: "box-model", name: "Box Model" }

  const box = session({
    id: "ses_ssh",
    directory,
    title: "SSH session",
    model: { id: model.id, providerID: "opencode" },
  })

  const remote = { password: "ssh-1" }
  const prompts: unknown[] = []

  const config = {
    directory,
    project: project({ id: "proj_ssh", directory }),
    provider: provider(model),
    sessions: [box],
    pageMessages: () => ({ items: [] }),
  }

  const servers = await mockServers(page, {
    [SERVER]: { ...config, sessions: [] },
    [REMOTE_SERVER]: {
      ...config,
      password: () => remote.password,
      onPrompt: (input) => prompts.push(input.body.text),
    },
  })

  const path = `/server/${base64Encode("ssh:box")}/session/${box.id}`
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready", ssh: REMOTE_SERVER, path })}`,
  )
  await expectSessionTitle(page, box.title)

  // The remote server restarts behind the open tunnel with a new password and a renamed session. Health checks run
  // every 10 s; the first one it rejects disposes the session's controller, which ends its event stream.
  remote.password = "ssh-2"
  box.title = "SSH session after restart"
  await expect
    .poll(async () => (await servers[REMOTE_SERVER]!.transport.connections()).map((item) => !!item.endedBy), {
      timeout: 20_000,
    })
    .toEqual([true])
  // The session waits for a sign-in instead of showing what the disposed controller last loaded.
  await expect(page.getByText("Signed out of this server", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Drop SSH tunnel" }).click()
  await page.getByRole("button", { name: "Reconnect", exact: true }).click()
  await expectSessionTitle(page, box.title)
  const editor = page.locator('[data-component="composer-editor"]')
  await editor.fill("after sign-in")
  await editor.press("Enter")
  await expect.poll(() => prompts).toEqual(["after sign-in"])
})

test("a session being created on an SSH host that turns out incompatible says so", async ({ page }) => {
  const directory = "/home/box/project"
  const box = session({ id: "ses_ssh_incompatible", directory, title: "SSH incompatible session" })

  const config = {
    directory,
    project: project({ id: "proj_ssh_incompatible", directory }),
    provider: provider(),
    sessions: [box],
    pageMessages: () => ({ items: [] }),
  }

  await mockServers(page, { [SERVER]: { ...config, sessions: [] }, [REMOTE_SERVER]: config })
  const path = `/server/${base64Encode("ssh:box")}/session/${box.id}`
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready", ssh: REMOTE_SERVER, path })}`,
  )
  await expectSessionTitle(page, box.title)
  await page.getByRole("button", { name: "New session", exact: true }).click()

  // The create request stays in flight, so the new session stays in preparation.
  await holdRoute(page, new RegExp(`^${REMOTE_SERVER.replace(/[.]/g, "\\.")}/api/session(\\?|$)`), { method: "POST" })
  const editor = page.locator('[data-component="composer-editor"]')
  const send = page.getByRole("button", { name: "Send", exact: true })
  await expect(page.locator('[data-component="new-session"]')).toBeVisible()
  await expect(editor).toBeEditable()
  await editor.fill("start on the box")
  await expect(editor).toHaveText("start on the box")
  await expect(send).toBeEnabled()
  await send.click()
  const preparing = page.locator('[data-component="session-preparing"]')
  await expect(preparing).toBeVisible()

  // The SSH plugin covers a host that is not ready; the route stays mounted beneath its cover.
  await page.getByRole("button", { name: "Report incompatible SSH server" }).click()
  await expect(page.getByRole("heading", { name: "SSH connection inactive", exact: true })).toBeVisible()
  await expect(page.getByText("This server version isn't supported", { exact: true })).toBeAttached()
  await expect(preparing).toHaveCount(0)
})
