import { test, expect } from "../fixtures"
import { openSidebar } from "../actions"
import { createSdk, serverUrl } from "../utils"

test("opening a project on one context appears on a fresh second context", async ({ page, withProject }) => {
  await withProject(async ({ directory, gotoSession }) => {
    await gotoSession()
    await openSidebar(page)

    // Ensure the sidebar open was synced to server
    const sdk = createSdk(directory)
    const res = await sdk.project.sidebar.list()
    expect(res.data!.length).toBeGreaterThanOrEqual(1)
    expect(res.data!.some((item: { worktree: string }) => item.worktree === directory)).toBe(true)
  })
})

test("closing a project on one context removes it from the server sidebar", async ({ withProject }) => {
  await withProject(async ({ directory }) => {
    const sdk = createSdk(directory)

    // Open then close
    await sdk.project.sidebar.open({ worktree: directory })
    await sdk.project.sidebar.close({ worktree: directory })

    const res = await sdk.project.sidebar.list()
    expect(res.data!.every((item: { worktree: string }) => item.worktree !== directory)).toBe(true)
  })
})

test("reorder persists across server calls", async ({ withProject }) => {
  await withProject(async ({ directory }) => {
    const sdk = createSdk(directory)
    const dir2 = directory + "-fake2"
    const dir3 = directory + "-fake3"

    await sdk.project.sidebar.reorder({ worktrees: [dir3, directory, dir2] })

    const res = await sdk.project.sidebar.list()
    const order = res.data!.map((item: { worktree: string }) => item.worktree)
    expect(order).toEqual([dir3, directory, dir2])
  })
})
