import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"

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
import { inlineInputSelector, workspaceItemSelector } from "../selectors"
import { dirSlug } from "../utils"

async function setupWorkspaceTest(page: Page, project: { slug: string; trackDirectory: (directory: string) => void }) {
  const rootSlug = project.slug
  await openSidebar(page)

  await setWorkspacesEnabled(page, rootSlug, true)

  await page.getByRole("button", { name: "New workspace" }).first().click()
  const next = await resolveSlug(await waitSlug(page, [rootSlug]))
  await waitDir(page, next.directory)
  project.trackDirectory(next.directory)

  await openSidebar(page)

  await expect
    .poll(
      async () => {
        const item = page.locator(workspaceItemSelector(next.slug)).first()
        try {
          await item.hover({ timeout: 500 })
          return true
        } catch {
          return false
        }
      },
      { timeout: 60_000 },
    )
    .toBe(true)

  return { rootSlug, slug: next.slug, directory: next.directory }
}

test("can enable and disable workspaces from project menu", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()

  await openSidebar(page)

  await expect(page.getByRole("button", { name: "New session" }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "New workspace" })).toHaveCount(0)

  await setWorkspacesEnabled(page, project.slug, true)
  await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()
  await expect(page.locator(workspaceItemSelector(project.slug)).first()).toBeVisible()

  await setWorkspacesEnabled(page, project.slug, false)
  await expect(page.getByRole("button", { name: "New session" }).first()).toBeVisible()
  await expect(page.locator(workspaceItemSelector(project.slug))).toHaveCount(0)
})

test("can create a workspace", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()

  await openSidebar(page)
  await setWorkspacesEnabled(page, project.slug, true)

  await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()

  await page.getByRole("button", { name: "New workspace" }).first().click()
  const next = await resolveSlug(await waitSlug(page, [project.slug]))
  await waitDir(page, next.directory)
  project.trackDirectory(next.directory)

  await openSidebar(page)

  await expect
    .poll(
      async () => {
        const item = page.locator(workspaceItemSelector(next.slug)).first()
        try {
          await item.hover({ timeout: 500 })
          return true
        } catch {
          return false
        }
      },
      { timeout: 60_000 },
    )
    .toBe(true)

  await expect(page.locator(workspaceItemSelector(next.slug)).first()).toBeVisible()
})

test("non-git projects keep workspace mode disabled", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-project-nongit-"))
  const nonGitSlug = dirSlug(nonGit)

  await fs.writeFile(path.join(nonGit, "README.md"), "# e2e nongit\n")

  try {
    await project.open({ extra: [nonGit] })
    await page.goto(`/${nonGitSlug}/session`)

    await expect.poll(() => slugFromUrl(page.url()), { timeout: 30_000 }).not.toBe("")

    const activeDir = await resolveSlug(slugFromUrl(page.url())).then((item) => item.directory)
    expect(path.basename(activeDir)).toContain("opencode-e2e-project-nongit-")

    await openSidebar(page)
    await expect(page.getByRole("button", { name: "New workspace" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Create Git repository" })).toBeVisible()
  } finally {
    await cleanupTestProject(nonGit)
  }
})

test("can rename a workspace", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()

  const { slug } = await setupWorkspaceTest(page, project)

  const rename = `e2e workspace ${Date.now()}`
  const menu = await openWorkspaceMenu(page, slug)
  await clickMenuItem(menu, /^Rename$/i, { force: true })

  await expect(menu).toHaveCount(0)

  const item = page.locator(workspaceItemSelector(slug)).first()
  await expect(item).toBeVisible()
  const input = item.locator(inlineInputSelector).first()
  const shown = await input
    .isVisible()
    .then((x) => x)
    .catch(() => false)
  if (!shown) {
    const retry = await openWorkspaceMenu(page, slug)
    await clickMenuItem(retry, /^Rename$/i, { force: true })
    await expect(retry).toHaveCount(0)
  }
  await expect(input).toBeVisible()
  await input.fill(rename)
  await input.press("Enter")
  await expect(item).toContainText(rename)
})

test("can reset a workspace", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()

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
      const files = await project.sdk.file
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
        const files = await project.sdk.file
          .status({ directory: createdDir })
          .then((r) => r.data ?? [])
          .catch(() => [])
        return files.length
      },
      { timeout: 120_000 },
    )
    .toBe(0)

  await expect.poll(() => fs.readFile(readme, "utf8"), { timeout: 120_000 }).toBe(original)

  await expect
    .poll(async () => {
      return await fs
        .stat(extra)
        .then(() => true)
        .catch(() => false)
    })
    .toBe(false)
})

test("can reorder workspaces by drag and drop", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()
  const rootSlug = project.slug

  const listSlugs = async () => {
    const nodes = page.locator('[data-component="sidebar-nav-desktop"] [data-component="workspace-item"]')
    const slugs = await nodes.evaluateAll((els) => {
      return els.map((el) => el.getAttribute("data-workspace") ?? "").filter((x) => x.length > 0)
    })
    return slugs
  }

  const waitReady = async (slug: string) => {
    await expect
      .poll(
        async () => {
          const item = page.locator(workspaceItemSelector(slug)).first()
          try {
            await item.hover({ timeout: 500 })
            return true
          } catch {
            return false
          }
        },
        { timeout: 60_000 },
      )
      .toBe(true)
  }

  const drag = async (from: string, to: string) => {
    const src = page.locator(workspaceItemSelector(from)).first()
    const dst = page.locator(workspaceItemSelector(to)).first()

    const a = await src.boundingBox()
    const b = await dst.boundingBox()
    if (!a || !b) throw new Error("Failed to resolve workspace drag bounds")

    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
    await page.mouse.up()
  }

  await openSidebar(page)

  await setWorkspacesEnabled(page, rootSlug, true)

  const workspaces = [] as { directory: string; slug: string }[]
  for (const _ of [0, 1]) {
    const prev = slugFromUrl(page.url())
    await page.getByRole("button", { name: "New workspace" }).first().click()
    const next = await resolveSlug(await waitSlug(page, [rootSlug, prev]))
    await waitDir(page, next.directory)
    project.trackDirectory(next.directory)
    workspaces.push(next)

    await openSidebar(page)
  }

  if (workspaces.length !== 2) throw new Error("Expected two created workspaces")

  const a = workspaces[0].slug
  const b = workspaces[1].slug

  await waitReady(a)
  await waitReady(b)

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

  await drag(from, to)

  await expect.poll(async () => await list()).toEqual([from, to])
})

test("can delete a workspace", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await project.open()

  const rootSlug = project.slug
  await openSidebar(page)
  await setWorkspacesEnabled(page, rootSlug, true)

  const created = await project.sdk.worktree.create({ directory: project.directory }).then((res) => res.data)
  if (!created?.directory) throw new Error("Failed to create workspace for delete test")

  const directory = created.directory
  const slug = dirSlug(directory)
  project.trackDirectory(directory)

  await page.reload()
  await openSidebar(page)
  await expect(page.locator(workspaceItemSelector(slug)).first()).toBeVisible({ timeout: 60_000 })

  await expect
    .poll(
      async () => {
        const worktrees = await project.sdk.worktree
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
        const worktrees = await project.sdk.worktree
          .list()
          .then((r) => r.data ?? [])
          .catch(() => [] as string[])
        return worktrees.includes(directory)
      },
      { timeout: 60_000 },
    )
    .toBe(false)

  await openSidebar(page)
  await expect(page.locator(workspaceItemSelector(slug))).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator(workspaceItemSelector(rootSlug)).first()).toBeVisible()
})
