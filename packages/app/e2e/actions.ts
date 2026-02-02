import { expect, type Locator, type Page } from "@playwright/test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { modKey, serverUrl } from "./utils"
import {
  sessionItemSelector,
  dropdownMenuTriggerSelector,
  dropdownMenuContentSelector,
  projectMenuTriggerSelector,
  projectWorkspacesToggleSelector,
  titlebarRightSelector,
  popoverBodySelector,
  listItemSelector,
  listItemKeySelector,
  listItemKeyStartsWithSelector,
  workspaceItemSelector,
  workspaceMenuTriggerSelector,
} from "./selectors"
import type { createSdk } from "./utils"

export async function defocus(page: Page) {
  await page.mouse.click(5, 5)
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
  const main = page.locator("main")
  const classes = (await main.getAttribute("class")) ?? ""
  return classes.includes("xl:border-l")
}

export async function toggleSidebar(page: Page) {
  await defocus(page)
  await page.keyboard.press(`${modKey}+B`)
}

export async function openSidebar(page: Page) {
  if (!(await isSidebarClosed(page))) return
  await toggleSidebar(page)
  await expect(page.locator("main")).not.toHaveClass(/xl:border-l/)
}

export async function closeSidebar(page: Page) {
  if (await isSidebarClosed(page)) return
  await toggleSidebar(page)
  await expect(page.locator("main")).toHaveClass(/xl:border-l/)
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

  await fs.writeFile(path.join(root, "README.md"), "# e2e\n")

  execSync("git init", { cwd: root, stdio: "ignore" })
  execSync("git add -A", { cwd: root, stdio: "ignore" })
  execSync('git -c user.name="e2e" -c user.email="e2e@example.com" commit -m "init" --allow-empty', {
    cwd: root,
    stdio: "ignore",
  })

  return root
}

export async function cleanupTestProject(directory: string) {
  await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
}

export function sessionIDFromUrl(url: string) {
  const match = /\/session\/([^/?#]+)/.exec(url)
  return match?.[1]
}

export async function hoverSessionItem(page: Page, sessionID: string) {
  const sessionEl = page.locator(sessionItemSelector(sessionID)).first()
  await expect(sessionEl).toBeVisible()
  await sessionEl.hover()
  return sessionEl
}

export async function openSessionMoreMenu(page: Page, sessionID: string) {
  const sessionEl = await hoverSessionItem(page, sessionID)

  const menuTrigger = sessionEl.locator(dropdownMenuTriggerSelector).first()
  await expect(menuTrigger).toBeVisible()
  await menuTrigger.click()

  const menu = page.locator(dropdownMenuContentSelector).first()
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
    await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
  }
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
  const trigger = page.locator(projectMenuTriggerSelector(projectSlug)).first()
  await expect(trigger).toHaveCount(1)

  await trigger.focus()
  await page.keyboard.press("Enter")

  const menu = page.locator(dropdownMenuContentSelector).first()
  const opened = await menu
    .waitFor({ state: "visible", timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (opened) {
    const viewport = page.viewportSize()
    const x = viewport ? Math.max(viewport.width - 5, 0) : 1200
    const y = viewport ? Math.max(viewport.height - 5, 0) : 800
    await page.mouse.move(x, y)
    return menu
  }

  await trigger.click({ force: true })

  await expect(menu).toBeVisible()

  const viewport = page.viewportSize()
  const x = viewport ? Math.max(viewport.width - 5, 0) : 1200
  const y = viewport ? Math.max(viewport.height - 5, 0) : 800
  await page.mouse.move(x, y)
  return menu
}

export async function setWorkspacesEnabled(page: Page, projectSlug: string, enabled: boolean) {
  const current = await page
    .getByRole("button", { name: "New workspace" })
    .first()
    .isVisible()
    .then((x) => x)
    .catch(() => false)

  if (current === enabled) return

  await openProjectMenu(page, projectSlug)

  const toggle = page.locator(projectWorkspacesToggleSelector(projectSlug)).first()
  await expect(toggle).toBeVisible()
  await toggle.click({ force: true })

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
