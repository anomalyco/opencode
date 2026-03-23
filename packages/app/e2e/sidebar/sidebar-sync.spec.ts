import { test, expect } from "../fixtures"
import { createTestProject, cleanupTestProject } from "../actions"
import { createSdk, dirSlug } from "../utils"

test.describe("sidebar sync", () => {
  test("project opened via API is visible from a fresh page load", async ({ page, withProject }) => {
    await withProject(async ({ directory }) => {
      const sdk = createSdk(directory)
      await sdk.project.sidebar.open({ worktree: directory })

      // Fresh navigation triggers bootstrap which fetches sidebar
      await page.goto(`/${dirSlug(directory)}/session`)

      // Verify the server-side state is correct
      const res = await sdk.project.sidebar.list()
      expect(res.data!).toHaveLength(1)
      expect(res.data![0].worktree).toBe(directory)
    })
  })

  test("project closed via API is absent from server sidebar", async ({ withProject }) => {
    await withProject(async ({ directory }) => {
      const sdk = createSdk(directory)
      await sdk.project.sidebar.open({ worktree: directory })
      await sdk.project.sidebar.close({ worktree: directory })

      const res = await sdk.project.sidebar.list()
      expect(res.data!.every((item: { worktree: string }) => item.worktree !== directory)).toBe(true)
    })
  })

  test("reorder via API persists order for fresh clients", async ({ withProject }) => {
    let dir2 = ""
    await withProject(async ({ directory }) => {
      dir2 = await createTestProject()
      const sdk = createSdk(directory)
      await sdk.project.sidebar.reorder({ worktrees: [dir2, directory] })

      const res = await sdk.project.sidebar.list()
      const worktrees = res.data!.map((x: { worktree: string }) => x.worktree)
      expect(worktrees).toEqual([dir2, directory])
    })
    if (dir2) await cleanupTestProject(dir2)
  })

  test("migration seeds server from legacy local rail when server is empty", async ({ page, withProject }) => {
    await withProject(async ({ directory }) => {
      const sdk = createSdk(directory)

      // Verify server sidebar is empty before navigation
      const before = await sdk.project.sidebar.list()
      expect(before.data!).toHaveLength(0)

      // seedProjects already seeds localStorage with this directory via seedStorage,
      // navigating triggers the one-time migration effect
      await page.goto(`/${dirSlug(directory)}/session`)

      // Poll until migration populates server
      await expect
        .poll(
          async () => {
            const res = await sdk.project.sidebar.list()
            return res.data!.length
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0)

      const after = await sdk.project.sidebar.list()
      expect(after.data!.some((x: { worktree: string }) => x.worktree === directory)).toBe(true)
    })
  })

  test("existing server sidebar is not overwritten by legacy local state", async ({ page, withProject }) => {
    let dir2 = ""
    await withProject(async ({ directory }) => {
      dir2 = await createTestProject()
      const sdk = createSdk(directory)

      // Pre-populate server with dir2
      await sdk.project.sidebar.reorder({ worktrees: [dir2] })

      // localStorage has `directory` from seedProjects, but server already has dir2
      // Migration must not overwrite server rail
      await page.goto(`/${dirSlug(directory)}/session`)
      await page.waitForTimeout(3000)

      const res = await sdk.project.sidebar.list()
      const worktrees = res.data!.map((x: { worktree: string }) => x.worktree)
      expect(worktrees).toContain(dir2)
      expect(worktrees).not.toContain(directory)
    })
    if (dir2) await cleanupTestProject(dir2)
  })
})
