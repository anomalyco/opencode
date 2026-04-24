import { expect, type Locator, type Page } from "@playwright/test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { createSdk, modKey, serverUrl } from "./utils"
import {
  dropdownMenuContentSelector,
  titlebarRightSelector,
  popoverBodySelector,
  listItemSelector,
  listItemKeySelector,
  listItemKeyStartsWithSelector,
} from "./selectors"

export async function defocus(page: Page) {
  await page
    .evaluate(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })
    .catch(() => undefined)
}

export async function openPalette(page: Page) {
  await defocus(page)
  await page.keyboard.press(`${modKey}+P`)

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
  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  await expect(button).toBeVisible()
  return (await button.getAttribute("aria-expanded")) !== "true"
}

export async function toggleSidebar(page: Page) {
  await defocus(page)
  await page.keyboard.press(`${modKey}+B`)
}

export async function openSidebar(page: Page) {
  if (!(await isSidebarClosed(page))) return

  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
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

  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
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
  await defocus(page)

  const dialog = page.getByRole("dialog")
  await page.keyboard.press(`${modKey}+Comma`).catch(() => undefined)

  const opened = await dialog
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false)

  if (opened) return dialog

  await page.getByRole("button", { name: "Settings" }).first().click()
  await expect(dialog).toBeVisible()
  return dialog
}

// Stateless architecture: Seed project using database project ID
// The directory is now the raw project ID.
export async function seedProjects(page: Page, input: { projectId: string }) {
  const directory = input.projectId

  await page.addInitScript(
    (args: { directory: string; serverUrl: string }) => {
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
      const nextLast = { ...(lastProject as Record<string, unknown>) }
      nextLast.local = args.directory
      nextLast[args.serverUrl] = args.directory

      localStorage.setItem(
        key,
        JSON.stringify({
          list,
          lastProject: nextLast,
        }),
      )
    },
    { directory, serverUrl },
  )
}

// Stateless Architecture: createTestProject creates a database project, not a filesystem directory
export async function createTestProject(name = "E2E Test Project") {
  const sdk = createOpencodeClient({ baseUrl: serverUrl, throwOnError: true })
  const result = await sdk.project.create({ name })
  if (!result.data?.id) throw new Error("Failed to create test project")
  
  // Return virtual directory path like /projects/<id> for backward compatibility
  return `/projects/${result.data.id}`
}

// Stateless Architecture: cleanupTestProject is a no-op since there's no filesystem
export async function cleanupTestProject(_directory: string) {
  // In stateless architecture, projects are database records
  // They don't have local filesystem directories to clean up
  // Projects can be deleted via API if needed, but typically tests share a seeded project
}

export function slugFromUrl(url: string) {
  return /\/([^/]+)\/session(?:[/?#]|$)/.exec(url)?.[1] ?? ""
}

export async function waitSlug(page: Page, skip: string[] = []) {
  let prev = ""
  let next = ""
  await expect
    .poll(
      () => {
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
  sdk: ReturnType<typeof createSdk>
}) {
  const sdk = input.sdk
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
          if (part.state.input?.description !== input.description) return false
          return typeof part.state.metadata?.sessionId === "string" && part.state.metadata.sessionId.length > 0
        })

      if (!part) return
      const id = part.state.metadata?.sessionId
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
