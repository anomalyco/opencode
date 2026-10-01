import { expect, test, type Page } from "@playwright/test"
import { REMOTE_SERVER, SERVER, expectPath, project, seed, session, sessionHref, type TabSeed } from "../utils/app"
import { mockServers, type MockServerConfig } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directoryA = "C:/server-a"
const directoryB = "/home/server-b"
const sessionA = session({ id: "ses_server_a", directory: directoryA, title: "Server A session" })
const childA = session({
  id: "ses_server_a_child",
  directory: directoryA,
  title: "Server A child",
  parentID: sessionA.id,
})
const sessionB = session({ id: "ses_server_b", directory: directoryB, title: "Server B session" })

type Reply = { origin: string; sessionID: string; permissionID: string; body: unknown }

test.use({ serviceWorkers: "block" })

function pending(id: string, sessionID: string) {
  return { id, sessionID, action: "shell", resources: ["git status"], metadata: {}, save: [] }
}

async function setup(page: Page, input: { tabs: TabSeed[]; a?: Partial<MockServerConfig> }) {
  const replies: Reply[] = []
  const lists: URL[] = []
  const sessionGets: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/api/permission/request") lists.push(url)
  })
  const config = (origin: string, name: string, directory: string, sessions: ReturnType<typeof session>[]) => {
    const id = name.toLowerCase().replace(" ", "-")
    return {
      directory,
      project: project({ id: `proj_${id}`, directory }),
      provider: {
        all: [{ id, name: `${name} Provider`, models: { [id]: { id, name: `${name} Model` } } }],
        connected: [id],
        default: { providerID: id, modelID: id },
      },
      sessions,
      pageMessages: () => ({ items: [] }),
      sessionStatus: Object.fromEntries(sessions.map((item) => [item.id, { type: "running" }])),
      strictDirectory: true,
      onPermissionReply: (reply: Omit<Reply, "origin">) => replies.push({ origin, ...reply }),
    }
  }
  const servers = await mockServers(page, {
    [SERVER]: {
      ...config(SERVER, "Server A", directoryA, [sessionA, childA]),
      eventRetry: 20,
      onSession: (id) => sessionGets.push(id),
      ...input.a,
    },
    [REMOTE_SERVER]: config(REMOTE_SERVER, "Server B", directoryB, [sessionB]),
  })
  await seed(page, { servers: [REMOTE_SERVER], tabs: input.tabs })
  const listed = (origin: string, directory: string) =>
    expect
      .poll(() =>
        lists.some((url) => url.origin === origin && url.searchParams.get("location[directory]") === directory),
      )
      .toBe(true)
  const enableAutoAccept = async () => {
    await page.keyboard.press("Control+,")
    const autoAccept = page.getByTestId("settings-screen").locator('[data-action="settings-auto-accept-permissions"]')
    await autoAccept.locator('[data-slot="switch-control"]').click()
    await expect(autoAccept.getByRole("switch")).toBeChecked()
  }
  return { replies, sessionGets, transport: servers[SERVER]!.transport, listed, enableAutoAccept }
}

const reply = (sessionID: string, permissionID: string) => ({
  origin: SERVER,
  sessionID,
  permissionID,
  body: { decision: "once" },
})

test("settings opened from a remote session sweep every server and keep the remote scope", async ({ page }) => {
  // Server A has no tab and is never visited: its pending request proves one toggle sweeps every connected server.
  const view = await setup(page, { tabs: [], a: { permissions: [pending("permission-pending-a", sessionA.id)] } })
  await page.goto(sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)

  await view.enableAutoAccept()
  const settings = page.getByTestId("settings-screen")
  await expect(page).toHaveURL("/settings")
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toHaveCount(0)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await view.listed(REMOTE_SERVER, directoryB)
  await expect.poll(() => view.replies).toEqual([reply(sessionA.id, "permission-pending-a")])

  await settings.getByRole("tab", { name: "127.0.0.1:4097", exact: true }).click()
  await expect(settings.getByRole("tab")).toHaveText([
    "127.0.0.1:4097",
    "Projects",
    "Worktrees",
    "Providers",
    "Models",
    "Extensions",
  ])
  await settings.getByRole("tab", { name: "Models" }).click()
  await expect(settings.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(settings.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
  await settings.getByRole("button", { name: "Back to settings" }).click()
  await settings.getByRole("button", { name: "Back to app" }).click()
  await expect(settings).toBeHidden()
  await expectPath(page, sessionHref(sessionB.id, REMOTE_SERVER))
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toContainText(sessionB.title)
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL("/settings")
  await page.keyboard.press("Escape")
  await expectPath(page, sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)
})

test("auto-accept responds for an unfocused server session and its child", async ({ page }) => {
  const view = await setup(page, { tabs: [sessionA.id, { session: sessionB.id, server: REMOTE_SERVER }] })
  await page.goto(sessionHref(sessionA.id))
  await expectSessionTitle(page, sessionA.title)
  await view.enableAutoAccept()
  await view.listed(SERVER, directoryA)
  await page.keyboard.press("Escape")

  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionB.id, REMOTE_SERVER)}"])`).click()
  await expectSessionTitle(page, sessionB.title)
  await view.transport.waitForConnection()
  for (const [index, item] of [sessionA, childA].entries()) {
    await view.transport.send({
      id: `evt_permission_background_${index}`,
      created: 1700000001000 + index,
      type: "permission.asked",
      location: { directory: directoryA },
      data: { ...pending(`permission-background-${index}`, item.id) },
    })
  }
  await expect
    .poll(() => view.replies)
    .toEqual([reply(sessionA.id, "permission-background-0"), reply(childA.id, "permission-background-1")])
})

test("auto-accept sweeps again after a reconnect and resyncs active sessions", async ({ page }) => {
  const queued: ReturnType<typeof pending>[] = []
  const failures = { next: 0 }
  const view = await setup(page, {
    tabs: [sessionA.id],
    a: {
      permissions: () => queued,
      permissionListFailures: () => failures.next-- > 0,
    },
  })
  await page.goto(sessionHref(sessionA.id))
  await expectSessionTitle(page, sessionA.title)
  const first = await view.transport.waitForConnection()
  await view.enableAutoAccept()
  await view.listed(SERVER, directoryA)
  await page.keyboard.press("Escape")

  // Asked while the client is disconnected, so only a reconnect sweep finds it. The first listing after the
  // reconnect fails, so only the bounded sweep retry can deliver the reply.
  queued.push(pending("permission-offline-a", sessionA.id))
  failures.next = 1
  const before = view.sessionGets.length
  await view.transport.disconnect()
  await view.transport.waitForConnection({ after: first.id })

  await expect.poll(() => view.replies).toEqual([reply(sessionA.id, "permission-offline-a")])
  expect(view.sessionGets.slice(before)).toContain(sessionA.id)
})

test("auto-accept approves a request discovered by opening a session", async ({ page }) => {
  // Served only by the per-session permission list, never by a location sweep or an event.
  const view = await setup(page, {
    tabs: [sessionA.id],
    a: { sessionPermissions: { [sessionA.id]: [pending("permission-synced-a", sessionA.id)] } },
  })
  await page.goto(sessionHref(sessionA.id))
  await expectSessionTitle(page, sessionA.title)
  await view.enableAutoAccept()
  await expect.poll(() => view.replies).toEqual([reply(sessionA.id, "permission-synced-a")])
})
