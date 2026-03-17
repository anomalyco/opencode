import { base64Decode } from "@opencode-ai/util/encode"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Page } from "@playwright/test"

import { test, expect } from "../fixtures"

test.describe.configure({ mode: "serial" })
import {
  createTestProject,
  cleanupTestProject,
  clickMenuItem,
  confirmDialog,
  openSidebar,
  openWorkspaceMenu,
  setWorkspacePinned,
  setWorkspacesEnabled,
  slugFromUrl,
  waitSlug,
} from "../actions"
import {
  dropdownMenuContentSelector,
  inlineInputSelector,
  projectSwitchSelector,
  workspaceDividerSelector,
  workspaceItemSelector,
} from "../selectors"
import { createSdk, dirSlug } from "../utils"

async function ensureWorkspacesEnabled(page: Page, slug: string) {
  for (const _ of [0, 1, 2]) {
    await openSidebar(page)
    await setWorkspacesEnabled(page, slug, true)
    const visible = await page
      .getByRole("button", { name: "New workspace" })
      .first()
      .isVisible()
      .then((x) => x)
      .catch(() => false)
    if (visible) return
  }
  await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible({ timeout: 60_000 })
}

async function setupWorkspaceTest(page: Page, project: { slug: string }) {
  const rootSlug = project.slug
  await openSidebar(page)

  await setWorkspacesEnabled(page, rootSlug, true)

  await page.getByRole("button", { name: "New workspace" }).first().click()
  const slug = await waitSlug(page, [rootSlug])
  const dir = base64Decode(slug)

  await openSidebar(page)

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

  return { rootSlug, slug, directory: dir }
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

  await withProject(async ({ slug }) => {
    await openSidebar(page)
    await setWorkspacesEnabled(page, slug, true)

    await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()

    await page.getByRole("button", { name: "New workspace" }).first().click()
    const workspaceSlug = await waitSlug(page, [slug])
    const workspaceDir = base64Decode(workspaceSlug)

    await openSidebar(page)

    await expect
      .poll(
        async () => {
          const item = page.locator(workspaceItemSelector(workspaceSlug)).first()
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

    await expect(page.locator(workspaceItemSelector(workspaceSlug)).first()).toBeVisible()

    await cleanupTestProject(workspaceDir)
  })
})

test("non-git projects keep workspace mode disabled", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-project-nongit-"))
  const nonGitSlug = dirSlug(nonGit)

  await fs.writeFile(path.join(nonGit, "README.md"), "# e2e nongit\n")

  try {
    await withProject(async () => {
      await page.goto(`/${nonGitSlug}/session`)

      await expect.poll(() => slugFromUrl(page.url()), { timeout: 30_000 }).not.toBe("")

      const activeDir = base64Decode(slugFromUrl(page.url()))
      expect(path.basename(activeDir)).toContain("opencode-e2e-project-nongit-")

      await openSidebar(page)
      await expect(page.getByRole("button", { name: "New workspace" })).toHaveCount(0)

      const trigger = page.locator('[data-action="project-menu"]').first()
      const hasMenu = await trigger
        .isVisible()
        .then((x) => x)
        .catch(() => false)
      if (!hasMenu) return

      await trigger.click({ force: true })

      const menu = page.locator(dropdownMenuContentSelector).first()
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
    await expect(page.locator(workspaceItemSelector(slug))).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator(workspaceItemSelector(rootSlug)).first()).toBeVisible()
  })
})

test("can pin and unpin a workspace with persistence", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await withProject(async ({ slug: rootSlug }) => {
    await ensureWorkspacesEnabled(page, rootSlug)

    const workspaces = [] as string[]
    for (const _ of [0, 1]) {
      const prev = slugFromUrl(page.url())
      await page.getByRole("button", { name: "New workspace" }).first().click()
      await expect
        .poll(
          () => {
            const slug = slugFromUrl(page.url())
            return slug.length > 0 && slug !== rootSlug && slug !== prev
          },
          { timeout: 45_000 },
        )
        .toBe(true)

      workspaces.push(slugFromUrl(page.url()))
      await openSidebar(page)
    }

    const a = workspaces[0]
    const b = workspaces[1]
    if (!a || !b) throw new Error("Expected two created workspaces")

    const key = (slug: string) => {
      return base64Decode(slug)
        .replace(/[\\/]+/g, "/")
        .replace(/\/+$/, "")
        .toLowerCase()
    }

    const aKey = key(a)
    const bKey = key(b)
    const rootKey = key(rootSlug)

    const list = async () => {
      const nodes = page.locator('[data-component="sidebar-nav-desktop"] [data-component="workspace-item"]')
      const slugs = await nodes.evaluateAll((els) => {
        return els.map((el) => el.getAttribute("data-workspace") ?? "").filter((x) => x.length > 0)
      })
      const seen = new Set<string>()
      return slugs
        .filter((slug) => {
          const slugKey = key(slug)
          if (seen.has(slugKey)) return false
          seen.add(slugKey)
          return true
        })
        .filter((slug) => {
          const slugKey = key(slug)
          return slugKey === aKey || slugKey === bKey
        })
    }

    const listAll = async () => {
      const nodes = page.locator('[data-component="sidebar-nav-desktop"] [data-component="workspace-item"]')
      const slugs = await nodes.evaluateAll((els) => {
        return els.map((el) => el.getAttribute("data-workspace") ?? "").filter((x) => x.length > 0)
      })
      const seen = new Set<string>()
      return slugs
        .filter((slug) => {
          const slugKey = key(slug)
          if (seen.has(slugKey)) return false
          seen.add(slugKey)
          return true
        })
        .filter((slug) => {
          const slugKey = key(slug)
          return slugKey === rootKey || slugKey === aKey || slugKey === bKey
        })
    }

    const find = async (target: string) => {
      const slugs = await listAll()
      return slugs.find((slug) => key(slug) === target)
    }

    await expect.poll(async () => (await list()).length).toBe(2)
    const before = await list()
    const aSlug = await find(aKey)
    if (!aSlug) throw new Error("Missing first workspace slug")

    await setWorkspacePinned(page, aSlug, true)
    await expect.poll(async () => (await list()).map((slug) => key(slug))).toEqual([aKey, bKey])

    await setWorkspacePinned(page, rootSlug, false)
    await expect.poll(async () => key((await listAll())[0] ?? "")).toBe(aKey)

    await setWorkspacePinned(page, rootSlug, true)
    await expect.poll(async () => key((await listAll())[0] ?? "")).toBe(rootKey)

    await page.reload()
    await openSidebar(page)
    await expect.poll(async () => (await list()).map((slug) => key(slug))).toEqual([aKey, bKey])

    const pinnedSlug = await find(aKey)
    if (!pinnedSlug) throw new Error("Missing pinned workspace slug")
    await setWorkspacePinned(page, pinnedSlug, false)
    await expect.poll(async () => await list()).toEqual(before)
  })
})

test("workspace pinning is isolated per project", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)
  const dirs = [] as string[]
  const key = (slug: string) =>
    base64Decode(slug)
      .replace(/[\\/]+/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase()

  try {
    await withProject(
      async ({ slug }) => {
        await ensureWorkspacesEnabled(page, slug)

        await page.getByRole("button", { name: "New workspace" }).first().click()
        await expect
          .poll(
            () => {
              const next = slugFromUrl(page.url())
              if (!next) return ""
              if (next === slug) return ""
              return next
            },
            { timeout: 45_000 },
          )
          .not.toBe("")

        const pinnedSlug = slugFromUrl(page.url())
        dirs.push(base64Decode(pinnedSlug))
        const pinnedKey = key(pinnedSlug)

        await openSidebar(page)
        await setWorkspacePinned(page, pinnedSlug, true)

        const pinnedMenu = await openWorkspaceMenu(page, pinnedSlug)
        await expect(
          pinnedMenu
            .getByRole("menuitem")
            .filter({ hasText: /^Unpin$/i })
            .first(),
        ).toBeVisible()
        await page.keyboard.press("Escape")

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click()
        await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

        await ensureWorkspacesEnabled(page, otherSlug)

        await page.getByRole("button", { name: "New workspace" }).first().click()
        await expect
          .poll(
            () => {
              const next = slugFromUrl(page.url())
              if (!next) return ""
              if (next === otherSlug) return ""
              return next
            },
            { timeout: 45_000 },
          )
          .not.toBe("")

        const otherWorkspace = slugFromUrl(page.url())
        dirs.push(base64Decode(otherWorkspace))

        await openSidebar(page)
        const otherMenu = await openWorkspaceMenu(page, otherWorkspace)
        await expect(otherMenu.getByRole("menuitem").filter({ hasText: /^Pin$/i }).first()).toBeVisible()
        await page.keyboard.press("Escape")

        const rootButton = page.locator(projectSwitchSelector(slug)).first()
        await expect(rootButton).toBeVisible()
        await rootButton.click()

        await openSidebar(page)
        const slugs = await page
          .locator('[data-component="sidebar-nav-desktop"] [data-component="workspace-item"]')
          .evaluateAll((els) => {
            return els.map((el) => el.getAttribute("data-workspace") ?? "").filter((x) => x.length > 0)
          })
        const rootSlug = slugs.find((slug) => key(slug) === pinnedKey)
        if (!rootSlug) throw new Error("Could not find pinned workspace in original project")

        const rootMenu = await openWorkspaceMenu(page, rootSlug)
        await expect(
          rootMenu
            .getByRole("menuitem")
            .filter({ hasText: /^Unpin$/i })
            .first(),
        ).toBeVisible()
      },
      { extra: [other] },
    )
  } finally {
    await Promise.all(dirs.map((dir) => cleanupTestProject(dir)))
    await cleanupTestProject(other)
  }
})

test("workspace divider is shown only with mixed pin state", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ slug: rootSlug }) => {
    await ensureWorkspacesEnabled(page, rootSlug)

    const workspaces = [] as string[]
    try {
      for (const _ of [0, 1]) {
        const prev = slugFromUrl(page.url())
        await page.getByRole("button", { name: "New workspace" }).first().click()
        await expect
          .poll(
            () => {
              const slug = slugFromUrl(page.url())
              return slug.length > 0 && slug !== rootSlug && slug !== prev
            },
            { timeout: 45_000 },
          )
          .toBe(true)

        workspaces.push(slugFromUrl(page.url()))
        await openSidebar(page)
      }

      const a = workspaces[0]
      const b = workspaces[1]
      if (!a || !b) throw new Error("Expected two created workspaces")

      await setWorkspacePinned(page, rootSlug, false)
      await setWorkspacePinned(page, a, true)
      await setWorkspacePinned(page, b, false)
      await expect.poll(async () => await page.locator(workspaceDividerSelector).count()).toBeGreaterThan(0)

      await setWorkspacePinned(page, a, false)
      await expect.poll(async () => await page.locator(workspaceDividerSelector).count()).toBe(0)
    } finally {
      await Promise.all(workspaces.map((slug) => cleanupTestProject(base64Decode(slug))))
    }
  })
})

test("can reorder workspaces by drag and drop", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await withProject(async ({ slug: rootSlug }) => {
    const workspaces = [] as { directory: string; slug: string }[]

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

    try {
      await openSidebar(page)

      await setWorkspacesEnabled(page, rootSlug, true)

      for (const _ of [0, 1]) {
        const prev = slugFromUrl(page.url())
        await page.getByRole("button", { name: "New workspace" }).first().click()
        const slug = await waitSlug(page, [rootSlug, prev])
        const dir = base64Decode(slug)
        workspaces.push({ slug, directory: dir })

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
    } finally {
      await Promise.all(workspaces.map((w) => cleanupTestProject(w.directory)))
    }
  })
})
