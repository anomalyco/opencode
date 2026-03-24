import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { expect, type Locator, type Page } from "@playwright/test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { terminalAttr, type E2EWindow } from "../src/testing/terminal"
import { createSdk, modKey, resolveDirectory, serverUrl } from "./utils"
import {
  dropdownMenuTriggerSelector,
  dropdownMenuContentSelector,
  projectSwitchSelector,
  projectMenuTriggerSelector,
  projectCloseMenuSelector,
  projectWorkspacesToggleSelector,
  titlebarRightSelector,
  popoverBodySelector,
  listItemSelector,
  listItemKeySelector,
  listItemKeyStartsWithSelector,
  promptSelector,
  terminalSelector,
  workspaceItemSelector,
  workspaceMenuTriggerSelector,
} from "./selectors"

const phase = new WeakMap<Page, "test" | "cleanup">()

export function setHealthPhase(page: Page, value: "test" | "cleanup") {
  phase.set(page, value)
}

export function healthPhase(page: Page) {
  return phase.get(page) ?? "test"
}

export async function defocus(page: Page) {
  await page
    .evaluate(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })
    .catch(() => undefined)
}

async function terminalID(term: Locator) {
  const id = await term.getAttribute(terminalAttr)
  if (id) return id
  throw new Error(`Active terminal missing ${terminalAttr}`)
}

export async function terminalConnects(page: Page, input?: { term?: Locator }) {
  const term = input?.term ?? page.locator(terminalSelector).first()
  const id = await terminalID(term)
  return page.evaluate((id) => {
    return (window as E2EWindow).__opencode_e2e?.terminal?.terminals?.[id]?.connects ?? 0
  }, id)
}

export async function disconnectTerminal(page: Page, input?: { term?: Locator }) {
  const term = input?.term ?? page.locator(terminalSelector).first()
  const id = await terminalID(term)
  await page.evaluate((id) => {
    ;(window as E2EWindow).__opencode_e2e?.terminal?.controls?.[id]?.disconnect?.()
  }, id)
}

async function terminalReady(page: Page, term?: Locator) {
  const next = term ?? page.locator(terminalSelector).first()
  const id = await terminalID(next)
  return page.evaluate((id) => {
    const state = (window as E2EWindow).__opencode_e2e?.terminal?.terminals?.[id]
    return !!state?.connected && (state.settled ?? 0) > 0
  }, id)
}

async function terminalFocusIdle(page: Page, term?: Locator) {
  const next = term ?? page.locator(terminalSelector).first()
  const id = await terminalID(next)
  return page.evaluate((id) => {
    const state = (window as E2EWindow).__opencode_e2e?.terminal?.terminals?.[id]
    return (state?.focusing ?? 0) === 0
  }, id)
}

async function terminalHas(page: Page, input: { term?: Locator; token: string }) {
  const next = input.term ?? page.locator(terminalSelector).first()
  const id = await terminalID(next)
  return page.evaluate(
    (input) => {
      const state = (window as E2EWindow).__opencode_e2e?.terminal?.terminals?.[input.id]
      return state?.rendered.includes(input.token) ?? false
    },
    { id, token: input.token },
  )
}

async function promptSlashActive(page: Page, id: string) {
  return page.evaluate((id) => {
    const state = (window as E2EWindow).__opencode_e2e?.prompt?.current
    if (state?.popover !== "slash") return false
    if (!state.slash.ids.includes(id)) return false
    return state.slash.active === id
  }, id)
}

async function promptSlashSelects(page: Page) {
  return page.evaluate(() => {
    return (window as E2EWindow).__opencode_e2e?.prompt?.current?.selects ?? 0
  })
}

async function promptSlashSelected(page: Page, input: { id: string; count: number }) {
  return page.evaluate((input) => {
    const state = (window as E2EWindow).__opencode_e2e?.prompt?.current
    if (!state) return false
    return state.selected === input.id && state.selects >= input.count
  }, input)
}

export async function waitTerminalReady(page: Page, input?: { term?: Locator; timeout?: number }) {
  const term = input?.term ?? page.locator(terminalSelector).first()
  const timeout = input?.timeout ?? 10_000
  await expect(term).toBeVisible()
  await expect(term.locator("textarea")).toHaveCount(1)
  await expect.poll(() => terminalReady(page, term), { timeout }).toBe(true)
}

export async function waitTerminalFocusIdle(page: Page, input?: { term?: Locator; timeout?: number }) {
  const term = input?.term ?? page.locator(terminalSelector).first()
  const timeout = input?.timeout ?? 10_000
  await waitTerminalReady(page, { term, timeout })
  await expect.poll(() => terminalFocusIdle(page, term), { timeout }).toBe(true)
}

export async function showPromptSlash(
  page: Page,
  input: { id: string; text: string; prompt?: Locator; timeout?: number },
) {
  const prompt = input.prompt ?? page.locator(promptSelector)
  const timeout = input.timeout ?? 10_000
  await expect
    .poll(
      async () => {
        await prompt.click().catch(() => false)
        await prompt.fill(input.text).catch(() => false)
        return promptSlashActive(page, input.id).catch(() => false)
      },
      { timeout },
    )
    .toBe(true)
}

export async function runPromptSlash(
  page: Page,
  input: { id: string; text: string; prompt?: Locator; timeout?: number },
) {
  const prompt = input.prompt ?? page.locator(promptSelector)
  const timeout = input.timeout ?? 10_000
  const count = await promptSlashSelects(page)
  await showPromptSlash(page, input)
  await prompt.press("Enter")
  await expect.poll(() => promptSlashSelected(page, { id: input.id, count: count + 1 }), { timeout }).toBe(true)
}

export async function runTerminal(page: Page, input: { cmd: string; token: string; term?: Locator; timeout?: number }) {
  const term = input.term ?? page.locator(terminalSelector).first()
  const timeout = input.timeout ?? 10_000
  await waitTerminalReady(page, { term, timeout })
  const textarea = term.locator("textarea")
  await term.click()
  await expect(textarea).toBeFocused()
  await page.keyboard.type(input.cmd)
  await page.keyboard.press("Enter")
  await expect.poll(() => terminalHas(page, { term, token: input.token }), { timeout }).toBe(true)
}

export async function openPalette(page: Page, key = "K") {
  await defocus(page)
  await page.keyboard.press(`${modKey}+${key}`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
  return dialog
}

export async function closeDialog(page: Page, dialog: Locator) {
  await page.keyboard.press("Escape")
  const closed = await dialog
    .waitFor({ state: "detached", timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (closed) return

  await page.keyboard.press("Escape")
  const closedSecond = await dialog
    .waitFor({ state: "detached", timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (closedSecond) return

  await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toHaveCount(0)
}

export async function isSidebarClosed(page: Page) {
  const button = await waitSidebarButton(page, "isSidebarClosed")
  return (await button.getAttribute("aria-expanded")) !== "true"
}

async function errorBoundaryText(page: Page) {
  const title = page.getByRole("heading", { name: /something went wrong/i }).first()
  if (!(await title.isVisible().catch(() => false))) return

  const description = await page
    .getByText(/an error occurred while loading the application\./i)
    .first()
    .textContent()
    .catch(() => "")
  const detail = await page
    .getByRole("textbox", { name: /error details/i })
    .first()
    .inputValue()
    .catch(async () =>
      (
        (await page
          .getByRole("textbox", { name: /error details/i })
          .first()
          .textContent()
          .catch(() => "")) ?? ""
      ).trim(),
    )

  return [title ? "Error boundary" : "", description ?? "", detail ?? ""].filter(Boolean).join("\n")
}

export async function assertHealthy(page: Page, context: string) {
  const text = await errorBoundaryText(page)
  if (!text) return
  console.log(`[e2e:error-boundary][${context}]\n${text}`)
  throw new Error(`Error boundary during ${context}\n${text}`)
}

async function waitSidebarButton(page: Page, context: string) {
  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  const boundary = page.getByRole("heading", { name: /something went wrong/i }).first()
  await button.or(boundary).first().waitFor({ state: "visible", timeout: 10_000 })
  await assertHealthy(page, context)
  return button
}

export async function toggleSidebar(page: Page) {
  await defocus(page)
  await page.keyboard.press(`${modKey}+B`)
}

export async function openSidebar(page: Page) {
  if (!(await isSidebarClosed(page))) return

  const button = await waitSidebarButton(page, "openSidebar")
  await button.click()

  const opened = await expect(button)
    .toHaveAttribute("aria-expanded", "true", { timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (opened) return

  await toggleSidebar(page)
  await expect(button).toHaveAttribute("aria-expanded", "true")
}

export async function closeSidebar(page: Page) {
  if (await isSidebarClosed(page)) return

  const button = await waitSidebarButton(page, "closeSidebar")
  await button.click()

  const closed = await expect(button)
    .toHaveAttribute("aria-expanded", "false", { timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (closed) return

  await toggleSidebar(page)
  await expect(button).toHaveAttribute("aria-expanded", "false")
}

export async function openSettings(page: Page) {
  await assertHealthy(page, "openSettings")
  await defocus(page)

  const dialog = page.getByRole("dialog")
  await page.keyboard.press(`${modKey}+Comma`).catch(() => undefined)

  const opened = await dialog
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false)

  if (opened) return dialog

  await assertHealthy(page, "openSettings")

  await page.getByRole("button", { name: "Settings" }).first().click()
  await expect(dialog).toBeVisible()
  return dialog
}

export async function seedProjects(page: Page, input: { directory: string; extra?: string[] }) {
  await page.addInitScript(
    (args: { directory: string; serverUrl: string; extra: string[] }) => {
      const key = "opencode.global.dat:server"
      const raw = localStorage.getItem(key)
      const parsed = (() => {
        if (!raw) return undefined
        try {
          return JSON.parse(raw) as unknown
        } catch {
          return undefined
        }
      })()

      const store = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
      const list = Array.isArray(store.list) ? store.list : []
      const lastProject = store.lastProject && typeof store.lastProject === "object" ? store.lastProject : {}
      const projects = store.projects && typeof store.projects === "object" ? store.projects : {}
      const nextProjects = { ...(projects as Record<string, unknown>) }

      const add = (origin: string, directory: string) => {
        const current = nextProjects[origin]
        const items = Array.isArray(current) ? current : []
        const existing = items.filter(
          (p): p is { worktree: string; expanded?: boolean } =>
            !!p &&
            typeof p === "object" &&
            "worktree" in p &&
            typeof (p as { worktree?: unknown }).worktree === "string",
        )

        if (existing.some((p) => p.worktree === directory)) return
        nextProjects[origin] = [{ worktree: directory, expanded: true }, ...existing]
      }

      const directories = [args.directory, ...args.extra]
      for (const directory of directories) {
        add("local", directory)
        add(args.serverUrl, directory)
      }

      localStorage.setItem(
        key,
        JSON.stringify({
          list,
          projects: nextProjects,
          lastProject,
        }),
      )
    },
    { directory: input.directory, serverUrl, extra: input.extra ?? [] },
  )
}

export async function createTestProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-project-"))
  const id = `e2e-${path.basename(root)}`

  await fs.writeFile(path.join(root, "README.md"), `# e2e\n\n${id}\n`)

  execSync("git init", { cwd: root, stdio: "ignore" })
  await fs.writeFile(path.join(root, ".git", "opencode"), id)
  execSync("git config core.fsmonitor false", { cwd: root, stdio: "ignore" })
  execSync("git add -A", { cwd: root, stdio: "ignore" })
  execSync('git -c user.name="e2e" -c user.email="e2e@example.com" commit -m "init" --allow-empty', {
    cwd: root,
    stdio: "ignore",
  })

  return resolveDirectory(root)
}

export async function cleanupTestProject(directory: string) {
  try {
    execSync("git fsmonitor--daemon stop", { cwd: directory, stdio: "ignore" })
  } catch {}
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)
}

export function slugFromUrl(url: string) {
  return /\/([^/]+)\/session(?:[/?#]|$)/.exec(url)?.[1] ?? ""
}

async function probeSession(page: Page) {
  return page
    .evaluate(() => {
      const win = window as E2EWindow
      const current = win.__opencode_e2e?.model?.current
      if (!current) return null
      return { dir: current.dir, sessionID: current.sessionID }
    })
    .catch(() => null as { dir?: string; sessionID?: string } | null)
}

export async function waitSlug(page: Page, skip: string[] = []) {
  let prev = ""
  let next = ""
  await expect
    .poll(
      async () => {
        await assertHealthy(page, "waitSlug")
        const slug = slugFromUrl(page.url())
        if (!slug) return ""
        if (skip.includes(slug)) return ""
        if (slug !== prev) {
          prev = slug
          next = ""
          return ""
        }
        next = slug
        return slug
      },
      { timeout: 45_000 },
    )
    .not.toBe("")
  return next
}

export async function resolveSlug(slug: string) {
  const directory = base64Decode(slug)
  if (!directory) throw new Error(`Failed to decode workspace slug: ${slug}`)
  const resolved = await resolveDirectory(directory)
  return { directory: resolved, slug: base64Encode(resolved), raw: slug }
}

export async function waitDir(page: Page, directory: string) {
  const target = await resolveDirectory(directory)
  await expect
    .poll(
      async () => {
        await assertHealthy(page, "waitDir")
        const slug = slugFromUrl(page.url())
        if (!slug) return ""
        return resolveSlug(slug)
          .then((item) => item.directory)
          .catch(() => "")
      },
      { timeout: 45_000 },
    )
    .toBe(target)
  return { directory: target, slug: base64Encode(target) }
}

export async function waitSession(page: Page, input: { directory: string; sessionID?: string }) {
  const target = await resolveDirectory(input.directory)
  await expect
    .poll(
      async () => {
        await assertHealthy(page, "waitSession")
        const slug = slugFromUrl(page.url())
        if (!slug) return false
        const resolved = await resolveSlug(slug).catch(() => undefined)
        if (!resolved || resolved.directory !== target) return false
        if (input.sessionID && sessionIDFromUrl(page.url()) !== input.sessionID) return false

        const state = await probeSession(page)
        if (input.sessionID && (!state || state.sessionID !== input.sessionID)) return false
        if (state?.dir) {
          const dir = await resolveDirectory(state.dir).catch(() => state.dir ?? "")
          if (dir !== target) return false
        }

        return page
          .locator(promptSelector)
          .first()
          .isVisible()
          .catch(() => false)
      },
      { timeout: 45_000 },
    )
    .toBe(true)
  return { directory: target, slug: base64Encode(target) }
}

export async function waitSessionSaved(directory: string, sessionID: string, timeout = 30_000) {
  const sdk = createSdk(directory)
  const target = await resolveDirectory(directory)

  await expect
    .poll(
      async () => {
        const data = await sdk.session
          .get({ sessionID })
          .then((x) => x.data)
          .catch(() => undefined)
        if (!data?.directory) return ""
        return resolveDirectory(data.directory).catch(() => data.directory)
      },
      { timeout },
    )
    .toBe(target)

  await expect
    .poll(
      async () => {
        const items = await sdk.session
          .messages({ sessionID, limit: 20 })
          .then((x) => x.data ?? [])
          .catch(() => [])
        return items.some((item) => item.info.role === "user")
      },
      { timeout },
    )
    .toBe(true)
}

export function sessionIDFromUrl(url: string) {
  const match = /\/session\/([^/?#]+)/.exec(url)
  return match?.[1]
}

export async function hoverSessionItem(page: Page, sessionID: string) {
  const sessionEl = page.locator(`[data-session-id="${sessionID}"]`).last()
  await expect(sessionEl).toBeVisible()
  await sessionEl.hover()
  return sessionEl
}

export async function openSessionMoreMenu(page: Page, sessionID: string) {
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}(?:[/?#]|$)`))

  const scroller = page.locator(".scroll-view__viewport").first()
  await expect(scroller).toBeVisible()
  await expect(scroller.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 })

  const menu = page
    .locator(dropdownMenuContentSelector)
    .filter({ has: page.getByRole("menuitem", { name: /rename/i }) })
    .filter({ has: page.getByRole("menuitem", { name: /archive/i }) })
    .filter({ has: page.getByRole("menuitem", { name: /delete/i }) })
    .first()

  const opened = await menu
    .isVisible()
    .then((x) => x)
    .catch(() => false)

  if (opened) return menu

  const menuTrigger = scroller.getByRole("button", { name: /more options/i }).first()
  await expect(menuTrigger).toBeVisible()
  await menuTrigger.click()

  await expect(menu).toBeVisible()
  return menu
}

export async function clickMenuItem(menu: Locator, itemName: string | RegExp, options?: { force?: boolean }) {
  const item = menu.getByRole("menuitem").filter({ hasText: itemName }).first()
  await expect(item).toBeVisible()
  await item.click({ force: options?.force })
}

export async function confirmDialog(page: Page, buttonName: string | RegExp) {
  const dialog = page.getByRole("dialog").first()
  await expect(dialog).toBeVisible()

  const button = dialog.getByRole("button").filter({ hasText: buttonName }).first()
  await expect(button).toBeVisible()
  await button.click()
}

export async function openSharePopover(page: Page) {
  const rightSection = page.locator(titlebarRightSelector)
  const shareButton = rightSection.getByRole("button", { name: "Share" }).first()
  await expect(shareButton).toBeVisible()

  const popoverBody = page
    .locator(popoverBodySelector)
    .filter({ has: page.getByRole("button", { name: /^(Publish|Unpublish)$/ }) })
    .first()

  const opened = await popoverBody
    .isVisible()
    .then((x) => x)
    .catch(() => false)

  if (!opened) {
    await shareButton.click()
    await expect(popoverBody).toBeVisible()
  }
  return { rightSection, popoverBody }
}

export async function clickPopoverButton(page: Page, buttonName: string | RegExp) {
  const button = page.getByRole("button").filter({ hasText: buttonName }).first()
  await expect(button).toBeVisible()
  await button.click()
}

export async function clickListItem(
  container: Locator | Page,
  filter: string | RegExp | { key?: string; text?: string | RegExp; keyStartsWith?: string },
): Promise<Locator> {
  let item: Locator

  if (typeof filter === "string" || filter instanceof RegExp) {
    item = container.locator(listItemSelector).filter({ hasText: filter }).first()
  } else if (filter.keyStartsWith) {
    item = container.locator(listItemKeyStartsWithSelector(filter.keyStartsWith)).first()
  } else if (filter.key) {
    item = container.locator(listItemKeySelector(filter.key)).first()
  } else if (filter.text) {
    item = container.locator(listItemSelector).filter({ hasText: filter.text }).first()
  } else {
    throw new Error("Invalid filter provided to clickListItem")
  }

  await expect(item).toBeVisible()
  await item.click()
  return item
}

async function status(sdk: ReturnType<typeof createSdk>, sessionID: string) {
  const data = await sdk.session
    .status()
    .then((x) => x.data ?? {})
    .catch(() => undefined)
  return data?.[sessionID]
}

async function stable(sdk: ReturnType<typeof createSdk>, sessionID: string, timeout = 10_000) {
  let prev = ""
  await expect
    .poll(
      async () => {
        const info = await sdk.session
          .get({ sessionID })
          .then((x) => x.data)
          .catch(() => undefined)
        if (!info) return true
        const next = `${info.title}:${info.time.updated ?? info.time.created}`
        if (next !== prev) {
          prev = next
          return false
        }
        return true
      },
      { timeout },
    )
    .toBe(true)
}

export async function waitSessionIdle(sdk: ReturnType<typeof createSdk>, sessionID: string, timeout = 30_000) {
  await expect.poll(() => status(sdk, sessionID).then((x) => !x || x.type === "idle"), { timeout }).toBe(true)
}

export async function cleanupSession(input: {
  sessionID: string
  directory?: string
  sdk?: ReturnType<typeof createSdk>
}) {
  const sdk = input.sdk ?? (input.directory ? createSdk(input.directory) : undefined)
  if (!sdk) throw new Error("cleanupSession requires sdk or directory")
  await waitSessionIdle(sdk, input.sessionID, 5_000).catch(() => undefined)
  const current = await status(sdk, input.sessionID).catch(() => undefined)
  if (current && current.type !== "idle") {
    await sdk.session.abort({ sessionID: input.sessionID }).catch(() => undefined)
    await waitSessionIdle(sdk, input.sessionID).catch(() => undefined)
  }
  await stable(sdk, input.sessionID).catch(() => undefined)
  await sdk.session.delete({ sessionID: input.sessionID }).catch(() => undefined)
}

export async function withSession<T>(
  sdk: ReturnType<typeof createSdk>,
  title: string,
  callback: (session: { id: string; title: string }) => Promise<T>,
): Promise<T> {
  const session = await sdk.session.create({ title }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")

  try {
    return await callback(session)
  } finally {
    await cleanupSession({ sdk, sessionID: session.id })
  }
}

const seedSystem = [
  "You are seeding deterministic e2e UI state.",
  "Follow the user's instruction exactly.",
  "When asked to call a tool, call exactly that tool exactly once with the exact JSON input.",
  "Do not call any extra tools.",
].join(" ")

const wait = async <T>(input: { probe: () => Promise<T | undefined>; timeout?: number }) => {
  const timeout = input.timeout ?? 30_000
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await input.probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const seed = async <T>(input: {
  sessionID: string
  prompt: string
  sdk: ReturnType<typeof createSdk>
  probe: () => Promise<T | undefined>
  timeout?: number
  attempts?: number
}) => {
  for (let i = 0; i < (input.attempts ?? 2); i++) {
    await input.sdk.session.promptAsync({
      sessionID: input.sessionID,
      agent: "build",
      system: seedSystem,
      parts: [{ type: "text", text: input.prompt }],
    })
    const value = await wait({ probe: input.probe, timeout: input.timeout })
    if (value !== undefined) return value
  }
}

export async function seedSessionQuestion(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    questions: Array<{
      header: string
      question: string
      options: Array<{ label: string; description: string }>
      multiple?: boolean
      custom?: boolean
    }>
  },
) {
  const first = input.questions[0]
  if (!first) throw new Error("Question seed requires at least one question")

  const text = [
    "Your only valid response is one question tool call.",
    `Use this JSON input: ${JSON.stringify({ questions: input.questions })}`,
    "Do not output plain text.",
    "After calling the tool, wait for the user response.",
  ].join("\n")

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const list = await sdk.question.list().then((x) => x.data ?? [])
      return list.find((item) => item.sessionID === input.sessionID && item.questions[0]?.header === first.header)
    },
  })

  if (!result) throw new Error("Timed out seeding question request")
  return { id: result.id }
}

export async function seedSessionPermission(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    permission: string
    patterns: string[]
    description?: string
  },
) {
  const text = [
    "Your only valid response is one bash tool call.",
    `Use this JSON input: ${JSON.stringify({
      command: input.patterns[0] ? `ls ${JSON.stringify(input.patterns[0])}` : "pwd",
      workdir: "/",
      description: input.description ?? `seed ${input.permission} permission request`,
    })}`,
    "Do not output plain text.",
  ].join("\n")

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const list = await sdk.permission.list().then((x) => x.data ?? [])
      return list.find((item) => item.sessionID === input.sessionID)
    },
  })

  if (!result) throw new Error("Timed out seeding permission request")
  return { id: result.id }
}

export async function seedSessionTask(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    description: string
    prompt: string
    subagentType?: string
  },
) {
  const text = [
    "Your only valid response is one task tool call.",
    `Use this JSON input: ${JSON.stringify({
      description: input.description,
      prompt: input.prompt,
      subagent_type: input.subagentType ?? "general",
    })}`,
    "Do not output plain text.",
    "Wait for the task to start and return the child session id.",
  ].join("\n")

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 90_000,
    probe: async () => {
      const messages = await sdk.session.messages({ sessionID: input.sessionID, limit: 50 }).then((x) => x.data ?? [])
      const part = messages
        .flatMap((message) => message.parts)
        .find((part) => {
          if (part.type !== "tool" || part.tool !== "task") return false
          if (!("state" in part) || !part.state || typeof part.state !== "object") return false
          if (!("input" in part.state) || !part.state.input || typeof part.state.input !== "object") return false
          if (!("description" in part.state.input) || part.state.input.description !== input.description) return false
          if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object")
            return false
          if (!("sessionId" in part.state.metadata)) return false
          return typeof part.state.metadata.sessionId === "string" && part.state.metadata.sessionId.length > 0
        })

      if (!part || !("state" in part) || !part.state || typeof part.state !== "object") return
      if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
      if (!("sessionId" in part.state.metadata)) return
      const id = part.state.metadata.sessionId
      if (typeof id !== "string" || !id) return
      const child = await sdk.session
        .get({ sessionID: id })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!child?.id) return
      return { sessionID: id }
    },
  })

  if (!result) throw new Error("Timed out seeding task tool")
  return result
}

export async function seedSessionTodos(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    todos: Array<{ content: string; status: string; priority: string }>
  },
) {
  const text = [
    "Your only valid response is one todowrite tool call.",
    `Use this JSON input: ${JSON.stringify({ todos: input.todos })}`,
    "Do not output plain text.",
  ].join("\n")
  const target = JSON.stringify(input.todos)

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const todos = await sdk.session.todo({ sessionID: input.sessionID }).then((x) => x.data ?? [])
      if (JSON.stringify(todos) !== target) return
      return true
    },
  })

  if (!result) throw new Error("Timed out seeding todos")
  return true
}

export async function clearSessionDockSeed(sdk: ReturnType<typeof createSdk>, sessionID: string) {
  const [questions, permissions] = await Promise.all([
    sdk.question.list().then((x) => x.data ?? []),
    sdk.permission.list().then((x) => x.data ?? []),
  ])

  await Promise.all([
    ...questions
      .filter((item) => item.sessionID === sessionID)
      .map((item) => sdk.question.reject({ requestID: item.id }).catch(() => undefined)),
    ...permissions
      .filter((item) => item.sessionID === sessionID)
      .map((item) => sdk.permission.reply({ requestID: item.id, reply: "reject" }).catch(() => undefined)),
  ])

  return true
}

export async function openStatusPopover(page: Page) {
  await defocus(page)

  const rightSection = page.locator(titlebarRightSelector)
  const trigger = rightSection.getByRole("button", { name: /status/i }).first()

  const popoverBody = page.locator(popoverBodySelector).filter({ has: page.locator('[data-component="tabs"]') })

  const opened = await popoverBody
    .isVisible()
    .then((x) => x)
    .catch(() => false)

  if (!opened) {
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(popoverBody).toBeVisible()
  }

  return { rightSection, popoverBody }
}

export async function openProjectMenu(page: Page, projectSlug: string) {
  await openSidebar(page)
  const item = page.locator(projectSwitchSelector(projectSlug)).first()
  await expect(item).toBeVisible()
  await item.hover()

  const trigger = page.locator(projectMenuTriggerSelector(projectSlug)).first()
  await expect(trigger).toHaveCount(1)
  await expect(trigger).toBeVisible()

  const menu = page
    .locator(dropdownMenuContentSelector)
    .filter({ has: page.locator(projectCloseMenuSelector(projectSlug)) })
    .first()
  const close = menu.locator(projectCloseMenuSelector(projectSlug)).first()

  const clicked = await trigger
    .click({ force: true, timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (clicked) {
    const opened = await menu
      .waitFor({ state: "visible", timeout: 1500 })
      .then(() => true)
      .catch(() => false)
    if (opened) {
      await expect(close).toBeVisible()
      return menu
    }
  }

  await trigger.focus()
  await page.keyboard.press("Enter")

  const opened = await menu
    .waitFor({ state: "visible", timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (opened) {
    await expect(close).toBeVisible()
    return menu
  }

  throw new Error(`Failed to open project menu: ${projectSlug}`)
}

export async function setWorkspacesEnabled(page: Page, projectSlug: string, enabled: boolean) {
  const current = await page
    .getByRole("button", { name: "New workspace" })
    .first()
    .isVisible()
    .then((x) => x)
    .catch(() => false)

  if (current === enabled) return

  const flip = async (timeout?: number) => {
    const menu = await openProjectMenu(page, projectSlug)
    const toggle = menu.locator(projectWorkspacesToggleSelector(projectSlug)).first()
    await expect(toggle).toBeVisible()
    return toggle.click({ force: true, timeout })
  }

  const flipped = await flip(1500)
    .then(() => true)
    .catch(() => false)

  if (!flipped) await flip()

  const expected = enabled ? "New workspace" : "New session"
  await expect(page.getByRole("button", { name: expected }).first()).toBeVisible()
}

export async function openWorkspaceMenu(page: Page, workspaceSlug: string) {
  const item = page.locator(workspaceItemSelector(workspaceSlug)).first()
  await expect(item).toBeVisible()
  await item.hover()

  const trigger = page.locator(workspaceMenuTriggerSelector(workspaceSlug)).first()
  await expect(trigger).toBeVisible()
  await trigger.click({ force: true })

  const menu = page.locator(dropdownMenuContentSelector).first()
  await expect(menu).toBeVisible()
  return menu
}
