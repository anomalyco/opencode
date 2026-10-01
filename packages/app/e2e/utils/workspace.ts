import { expect, type Page } from "@playwright/test"
import {
  NO_PROVIDER,
  REMOTE_SERVER,
  SERVER,
  draftHref,
  project,
  provider,
  seed,
  session,
  sessionHref,
  type SeedInput,
  type TabSeed,
} from "./app"
import { mockOpenCodeServer, type MockServerConfig } from "./mock-server"
import { APP_READY_TIMEOUT, expectSessionTitle } from "./waits"

export type WorkspaceInput = Partial<Omit<MockServerConfig, "directory" | "project" | "sessions" | "server">> & {
  // Names the directory `C:/OpenCode/<name>`, project `proj_<slug>`, and default session `ses_<slug>`.
  name: string
  directory?: string
  // Merged over the default project.
  project?: Record<string, unknown>
  // Defaults to one session titled `name`. Omitted fields come from `session()`.
  sessions?: ({ id: string; title?: string } & Record<string, unknown>)[]
  // Merged over the default seed: the project expanded and last opened, and a tab for every session.
  seed?: SeedInput
}

// One project with sessions on the default mock server, plus the storage a returning user would have.
export async function mockWorkspace(page: Page, input: WorkspaceInput) {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  const directory = input.directory ?? `C:/OpenCode/${input.name}`
  const projectID = typeof input.project?.id === "string" ? input.project.id : `proj_${slug}`
  const sessions = (input.sessions ?? [{ id: `ses_${slug}`, title: input.name }]).map((item) =>
    session({ directory, projectID, ...item }),
  )
  const mock = await mockOpenCodeServer(page, {
    provider: provider(),
    pageMessages: () => ({ items: [] }),
    ...input,
    directory,
    project: project({ id: projectID, directory, name: input.name, ...input.project }),
    sessions,
  })
  await seed(page, {
    projects: { local: [{ worktree: directory, expanded: true }] },
    lastProject: { local: directory },
    tabs: sessions.map((item) => item.id),
    ...input.seed,
  })
  return { server: SERVER, directory, projectID, sessions, pty: mock.pty, push: mock.push }
}

// Opens a session (default: the first) and waits until its composer accepts input.
export async function openSession(page: Page, input: WorkspaceInput & { sessionID?: string }) {
  const workspace = await mockWorkspace(page, input)
  const target = workspace.sessions.find((item) => item.id === (input.sessionID ?? workspace.sessions[0]?.id))
  if (!target) throw new Error(`Unknown session ${input.sessionID}`)
  await page.goto(sessionHref(target.id))
  await expectSessionTitle(page, target.title)
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable({ timeout: APP_READY_TIMEOUT })
  return { ...workspace, session: target, editor }
}

// Opens a new-session draft (no sessions by default) and waits until its composer accepts input.
export async function openDraft(page: Page, input: WorkspaceInput & { draftID?: string }) {
  const draftID = input.draftID ?? `draft_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
  const directory = input.directory ?? `C:/OpenCode/${input.name}`
  const sessions = input.sessions ?? []
  const tabs: TabSeed[] = [...sessions.map((item) => item.id), { draft: draftID, directory }]
  const workspace = await mockWorkspace(page, { ...input, directory, sessions, seed: { tabs, ...input.seed } })
  await page.goto(draftHref(draftID))
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable({ timeout: APP_READY_TIMEOUT })
  return { ...workspace, draftID, editor }
}

// Opens a draft on the local project with "New worktree" selected. Worktree creation stays pending until the test
// resolves `worktree`; POST order (`worktree`, `session`, `prompt`), worktree requests, session creates and prompts are
// recorded. The draft tab comes first, then a tab per session.
export async function openWorktreeDraft(page: Page, input: WorkspaceInput & { draftID?: string }) {
  const worktree = Promise.withResolvers<{ status: number; json: unknown }>()
  const calls: string[] = []
  const worktreeRequests: { url: URL; body: Record<string, unknown> }[] = []
  const creates: Record<string, unknown>[] = []
  const prompts: { sessionID: string; body: Record<string, unknown> }[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const url = new URL(request.url())
    if (url.pathname === "/api/worktree") {
      calls.push("worktree")
      worktreeRequests.push({ url, body: request.postDataJSON() })
    }
    if (url.pathname === "/api/session") calls.push("session")
    if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) calls.push("prompt")
  })
  const draftID = input.draftID ?? `draft_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
  const directory = input.directory ?? `C:/OpenCode/${input.name}`
  const sessions = input.sessions ?? []
  const workspace = await mockWorkspace(page, {
    ...input,
    directory,
    sessions,
    onPrompt: (prompt) => {
      prompts.push(prompt)
      input.onPrompt?.(prompt)
    },
    onWorktreeCreate: async () => {
      const answer = await worktree.promise
      return { status: answer.status, body: answer.json }
    },
    onSessionCreate: (body, attempt) => {
      creates.push(body)
      return input.onSessionCreate?.(body, attempt)
    },
    seed: { tabs: [{ draft: draftID, directory }, ...sessions.map((item) => item.id)], ...input.seed },
  })
  await page.goto(draftHref(draftID))
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeVisible({ timeout: APP_READY_TIMEOUT })
  await page.getByRole("button", { name: "Local", exact: true }).click()
  await page.getByRole("menuitem", { name: "New worktree", exact: true }).click()
  await expect(page.getByRole("button", { name: "New worktree", exact: true })).toBeVisible()
  await expect(editor).toBeEditable()
  return { ...workspace, draftID, editor, worktree, calls, worktreeRequests, creates, prompts }
}

// A second single-project server (default `REMOTE_SERVER`) listed in the server picker; seeds merge with
// `openSettings`, `openSession`, and `mockWorkspace`.
export async function mockRemoteServer(
  page: Page,
  input: Partial<Omit<MockServerConfig, "server">> & { server?: string; name?: string } = {},
) {
  const server = input.server ?? REMOTE_SERVER
  const directory = input.directory ?? "/remote/project"
  const mock = await mockOpenCodeServer(page, {
    project: project({ id: "proj_remote", directory }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    ...input,
    server,
    directory,
  })
  await seed(page, { servers: [input.name ? { url: server, name: input.name } : server] })
  return mock
}

// Opens Settings from Home (through the Tabs drawer below 800px) and waits until it has focus.
export async function openSettings(page: Page, input: WorkspaceInput) {
  const workspace = await mockWorkspace(page, { sessions: [], ...input })
  await page.goto("/")
  if ((page.viewportSize()?.width ?? 1280) < 800) await page.getByRole("button", { name: "Tabs", exact: true }).click()
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeFocused({ timeout: APP_READY_TIMEOUT })
  return { ...workspace, settings }
}

export function fileNode(directory: string, path: string, type: "file" | "directory" = "file") {
  return { name: path.split("/").at(-1) ?? path, path, absolute: `${directory}/${path}`, type, ignored: false }
}

// A one-line change; `loaded: false` returns only the patch header, as for a diff whose body is still loading.
export function fileDiff(
  file: string,
  options: { additions?: number; deletions?: number; status?: "added" | "modified" | "deleted"; loaded?: boolean } = {},
) {
  const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}`
  return {
    file,
    additions: options.additions ?? 1,
    deletions: options.deletions ?? 1,
    status: options.status ?? "modified",
    patch:
      options.loaded === false
        ? header
        : `${header}\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after'\n`,
  }
}
