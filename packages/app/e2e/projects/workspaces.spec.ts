import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"
import type { WorkspaceProbeState } from "../../src/testing/workspace"

import { test, expect } from "../fixtures"

test.describe.configure({ mode: "serial" })
import {
  cleanupTestProject,
  clickMenuItem,
  confirmDialog,
  openSidebar,
  openWorkspaceMenu,
  resolveSlug,
  setWorkspacesEnabled,
  slugFromUrl,
  waitDir,
  waitSlug,
} from "../actions"
import {
  dropdownMenuContentSelector,
  inlineInputSelector,
  promptSelector,
  sessionItemSelector,
  workspaceItemSelector,
} from "../selectors"
import { createSdk, dirSlug } from "../utils"

type WorkspaceWindow = Window & {
  __opencode_e2e?: {
    workspace?: {
      current?: WorkspaceProbeState
      controls?: Record<string, { reorder?: (input: { from: string; to: string }) => boolean }>
    }
  }
}

async function workspaceState(page: Page) {
  return page.evaluate(() => {
    const state = (window as WorkspaceWindow).__opencode_e2e?.workspace?.current
    if (!state) return null
    return {
      root: state.root,
      current: state.current,
      enabled: state.enabled,
      items: state.items.map((item) => ({ ...item })),
    }
  })
}

async function waitWorkspace(page: Page, input: { slug: string; busy?: boolean; timeout?: number }) {
  await expect
    .poll(
      async () => {
        const state = await workspaceState(page)
        const item = state?.items.find((item) => item.slug === input.slug)
        if (!item) return false
        if (input.busy !== undefined && item.busy !== input.busy) return false
        return true
      },
      { timeout: input.timeout ?? 60_000 },
    )
    .toBe(true)
}

async function waitWorkspaceGone(page: Page, input: { slug: string; timeout?: number }) {
  await expect
    .poll(
      async () => {
        const state = await workspaceState(page)
        return state?.items.some((item) => item.slug === input.slug) ?? false
      },
      { timeout: input.timeout ?? 60_000 },
    )
    .toBe(false)
}

async function reorderWorkspace(page: Page, input: { root: string; from: string; to: string }) {
  const ok = await page.evaluate((input) => {
    return (window as WorkspaceWindow).__opencode_e2e?.workspace?.controls?.[input.root]?.reorder?.({
      from: input.from,
      to: input.to,
    })
  }, input)
  expect(ok).toBe(true)
}

async function setupWorkspaceTest(page: Page, project: { slug: string; trackDirectory: (directory: string) => void }) {
  const rootSlug = project.slug
  await openSidebar(page)

  await setWorkspacesEnabled(page, rootSlug, true)

  await page.getByRole("button", { name: "New workspace" }).first().click()
  const next = await resolveSlug(await waitSlug(page, [rootSlug]))
  await waitDir(page, next.directory)
  project.trackDirectory(next.directory)

  await openSidebar(page)
  await waitWorkspace(page, { slug: next.slug, busy: false })
  await expect(page.locator(workspaceItemSelector(next.slug)).first()).toBeVisible()

  return { rootSlug, slug: next.slug, directory: next.directory }
}

test("can enable and disable workspaces from project menu", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ slug }) => {
    await openSidebar(page)

    await expect(page.getByRole("button", { name: "New session" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: "New workspace" })).toHaveCount(0)

    await setWorkspacesEnabled(page, slug, true)
    await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()
    await expect(page.locator(workspaceItemSelector(slug)).first()).toBeVisible()

    await setWorkspacesEnabled(page, slug, false)
    await expect(page.getByRole("button", { name: "New session" }).first()).toBeVisible()
    await expect(page.locator(workspaceItemSelector(slug))).toHaveCount(0)
  })
})

test("can create a workspace", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async (project) => {
    const next = await setupWorkspaceTest(page, project)
    await expect(page.locator(workspaceItemSelector(next.slug)).first()).toBeVisible()
  })
})

test("non-git projects keep workspace mode disabled", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-project-nongit-"))
  const nonGitSlug = dirSlug(nonGit)

  await fs.writeFile(path.join(nonGit, "README.md"), "# e2e nongit\n")

  try {
    await withProject(async (project) => {
      const sdk = createSdk(nonGit)
      await page.goto(`/${nonGitSlug}/session`)

      await expect.poll(() => slugFromUrl(page.url()), { timeout: 30_000 }).not.toBe("")

      const activeDir = await resolveSlug(slugFromUrl(page.url())).then((item) => item.directory)
      expect(path.basename(activeDir)).toContain("opencode-e2e-project-nongit-")

      await openSidebar(page)
      await expect(page.locator(promptSelector)).toBeVisible()
      await expect(page.getByRole("button", { name: "New session" })).toBeVisible()
      await expect(page.getByRole("button", { name: "New workspace" })).toHaveCount(0)
      await expect(page.locator('[data-component="workspace-item"]')).toHaveCount(0)

      const session = await sdk.session.create({ title: `nongit ${Date.now()}` }).then((x) => x.data)
      if (!session?.id) throw new Error("Non-git session create did not return an id")
      project.trackSession(session.id, nonGit)
      await expect(page.locator(sessionItemSelector(session.id)).first()).toBeVisible()

      await expect
        .poll(async () => {
          return (await workspaceState(page))?.enabled ?? false
        })
        .toBe(false)

      const trigger = page.locator('[data-action="project-menu"]').first()
      if ((await trigger.count()) === 0) return

      await expect(trigger).toBeVisible()

      const menu = page.locator(dropdownMenuContentSelector).first()
      for (const _ of [0, 1, 2]) {
        await trigger.click({ force: true })
        if (await menu.isVisible().catch(() => false)) break
      }
      await expect(menu).toBeVisible()

      const toggle = menu.locator('[data-action="project-workspaces-toggle"]').first()

      await expect(toggle).toBeVisible()
      await expect(toggle).toBeDisabled()
      await expect(menu.getByRole("menuitem", { name: "New workspace" })).toHaveCount(0)
    })
  } finally {
    await cleanupTestProject(nonGit)
  }
})

test("can rename a workspace", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async (project) => {
    const { slug } = await setupWorkspaceTest(page, project)

    const rename = `e2e workspace ${Date.now()}`
    const menu = await openWorkspaceMenu(page, slug)
    await clickMenuItem(menu, /^Rename$/i, { force: true })

    await expect(menu).toHaveCount(0)

    const item = page.locator(workspaceItemSelector(slug)).first()
    await expect(item).toBeVisible()
    const input = item.locator(inlineInputSelector).first()
    await expect(input).toBeVisible()
    await input.fill(rename)
    await input.press("Enter")
    await expect(item).toContainText(rename)
  })
})

test("can reset a workspace", async ({ page, sdk, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async (project) => {
    const { slug, directory: createdDir } = await setupWorkspaceTest(page, project)

    const readme = path.join(createdDir, "README.md")
    const extra = path.join(createdDir, `e2e_reset_${Date.now()}.txt`)
    const original = await fs.readFile(readme, "utf8")
    const dirty = `${original.trimEnd()}\n\nchange_${Date.now()}\n`
    await fs.writeFile(readme, dirty, "utf8")
    await fs.writeFile(extra, `created_${Date.now()}\n`, "utf8")

    await expect
      .poll(async () => {
        return await fs
          .stat(extra)
          .then(() => true)
          .catch(() => false)
      })
      .toBe(true)

    await expect
      .poll(async () => {
        const files = await sdk.file
          .status({ directory: createdDir })
          .then((r) => r.data ?? [])
          .catch(() => [])
        return files.length
      })
      .toBeGreaterThan(0)

    const menu = await openWorkspaceMenu(page, slug)
    await clickMenuItem(menu, /^Reset$/i, { force: true })
    await confirmDialog(page, /^Reset workspace$/i)

    await expect
      .poll(
        async () => {
          const files = await sdk.file
            .status({ directory: createdDir })
            .then((r) => r.data ?? [])
            .catch(() => [])
          return files.length
        },
        { timeout: 60_000 },
      )
      .toBe(0)

    await expect.poll(() => fs.readFile(readme, "utf8"), { timeout: 60_000 }).toBe(original)

    await expect
      .poll(async () => {
        return await fs
          .stat(extra)
          .then(() => true)
          .catch(() => false)
      })
      .toBe(false)
  })
})

test("can delete a workspace", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)
    const { rootSlug, slug, directory } = await setupWorkspaceTest(page, project)

    await expect
      .poll(
        async () => {
          const worktrees = await sdk.worktree
            .list()
            .then((r) => r.data ?? [])
            .catch(() => [] as string[])
          return worktrees.includes(directory)
        },
        { timeout: 30_000 },
      )
      .toBe(true)

    const menu = await openWorkspaceMenu(page, slug)
    await clickMenuItem(menu, /^Delete$/i, { force: true })
    await confirmDialog(page, /^Delete workspace$/i)

    await expect.poll(() => base64Decode(slugFromUrl(page.url()))).toBe(project.directory)

    await expect
      .poll(
        async () => {
          const worktrees = await sdk.worktree
            .list()
            .then((r) => r.data ?? [])
            .catch(() => [] as string[])
          return worktrees.includes(directory)
        },
        { timeout: 60_000 },
      )
      .toBe(false)

    await project.gotoSession()

    await openSidebar(page)
    await waitWorkspaceGone(page, { slug })
    await expect(page.locator(workspaceItemSelector(slug))).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator(workspaceItemSelector(rootSlug)).first()).toBeVisible()
  })
})

test("can reorder workspaces by drag and drop", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await withProject(async (project) => {
    const rootSlug = project.slug
    const workspaces = [] as { directory: string; slug: string }[]

    const listSlugs = async () => {
      const nodes = page.locator('[data-component="sidebar-nav-desktop"] [data-component="workspace-item"]')
      const slugs = await nodes.evaluateAll((els) => {
        return els.map((el) => el.getAttribute("data-workspace") ?? "").filter((x) => x.length > 0)
      })
      return slugs
    }

    const listed = async (a: string, b: string) => {
      const state = await workspaceState(page)
      if (state?.root !== project.directory) return []
      return state.items.filter((item) => !item.local && (item.slug === a || item.slug === b)).map((item) => item.slug)
    }

    await openSidebar(page)

    await setWorkspacesEnabled(page, rootSlug, true)

    for (const _ of [0, 1]) {
      const prev = slugFromUrl(page.url())
      await page.getByRole("button", { name: "New workspace" }).first().click()
      const next = await resolveSlug(await waitSlug(page, [rootSlug, prev]))
      await waitDir(page, next.directory)
      project.trackDirectory(next.directory)
      workspaces.push(next)
      await waitWorkspace(page, { slug: next.slug, busy: false })

      await openSidebar(page)
    }

    if (workspaces.length !== 2) throw new Error("Expected two created workspaces")

    const a = workspaces[0].slug
    const b = workspaces[1].slug

    await expect.poll(async () => await listed(a, b)).toHaveLength(2)

    const list = async () => {
      const slugs = await listSlugs()
      return slugs.filter((s) => s !== rootSlug && (s === a || s === b)).slice(0, 2)
    }

    await expect
      .poll(async () => {
        const slugs = await list()
        return slugs.length === 2
      })
      .toBe(true)

    const before = await list()
    const from = before[1]
    const to = before[0]
    if (!from || !to) throw new Error("Failed to resolve initial workspace order")

    const dirs = new Map(workspaces.map((item) => [item.slug, item.directory]))
    const fromDir = dirs.get(from)
    const toDir = dirs.get(to)
    if (!fromDir || !toDir) throw new Error("Failed to resolve workspace directories for reorder")

    await reorderWorkspace(page, { root: project.directory, from: fromDir, to: toDir })

    await expect.poll(async () => await listed(a, b)).toEqual([from, to])
    await expect.poll(async () => await list()).toEqual([from, to])
  })
})
