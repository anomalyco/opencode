import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

test.use({ serviceWorkers: "block" })

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  for (const vcs of ["git", "hg"]) {
    test(`gates worktree creation but keeps existing moves for ${vcs} on ${viewport.name}`, async ({ page }, info) => {
      await page.setViewportSize(viewport)
      const destination = "C:/OpenCode/existing-checkout"
      const session = {
        id: "ses_worktree_capabilities",
        projectID: fixture.project.id,
        directory: fixture.directory,
        title: "Worktree capabilities",
      }
      const transport = await installSseTransport(page, { server: fixture.serverKey })
      await mockOpenCodeServer(page, {
        directory: fixture.directory,
        project: { ...fixture.project, vcs, sandboxes: [destination] },
        provider: fixture.provider,
        sessions: [session],
        pageMessages: () => ({
          items: [{ id: "msg_saved", type: "user", text: "Review this change", time: { created: 1 } }],
        }),
        fileList: () => [],
        vcsDiff: [
          { file: "file.txt", patch: "@@ -1 +1 @@\n-before\n+after", additions: 1, deletions: 1, status: "modified" },
        ],
      })
      const creations: string[] = []
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === `/api/worktree/${fixture.project.id}`)
          creations.push(request.url())
      })
      await page.route(`**/api/session/${session.id}/move`, (route) =>
        route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }),
      )
      await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${session.id}`)
      await expect(page.getByText("Review this change", { exact: true })).toBeVisible()
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
      await prompt.fill("Keep this draft")
      await openDetails(page, viewport.name === "mobile")

      const summary = page.locator('[data-component="session-summary-panel"]')
      await expect(summary.getByRole("button", { name: /^1 Changed file/ })).toBeVisible()
      await info.attach("summary", {
        body: await page.screenshot({ path: info.outputPath("summary.png"), animations: "disabled" }),
        contentType: "image/png",
      })
      await expect
        .soft(summary.getByRole("button", { name: "Move to worktree", exact: true }))
        .toHaveCount(vcs === "git" ? 1 : 0)

      await summary.getByRole("button", { name: "Local repository", exact: true }).click()
      const create = page.getByRole("menuitem", { name: "New worktree", exact: true })
      await expect(create).toBeVisible()
      await expect.soft(create).toBeEnabled({ enabled: vcs === "git" })
      await info.attach("destinations", {
        body: await page.screenshot({ path: info.outputPath("destinations.png"), animations: "disabled" }),
        contentType: "image/png",
      })
      await page.getByRole("menuitem", { name: "Worktree", exact: true }).press("ArrowRight")
      const existing = page.getByRole("menuitem", { name: "existing-checkout", exact: true })
      await expect(existing).toBeVisible()
      const move = page.waitForRequest(
        (request) =>
          request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${session.id}/move`,
      )
      await existing.press("Enter")
      expect((await move).postDataJSON()).toEqual({ directory: destination })
      session.directory = destination
      await transport.send({
        id: "evt_worktree_capabilities_moved",
        type: "session.moved",
        created: 2,
        durable: { aggregateID: session.id, seq: 1, version: 1 },
        data: { sessionID: session.id, location: { directory: destination }, projectID: fixture.project.id },
      })
      await expect(
        page.locator('[data-type="location-switched"]').getByText(destination, { exact: true }),
      ).toBeVisible()
      if (viewport.name === "mobile") await openDetails(page, true)
      await expect(summary.getByRole("button", { name: "existing-checkout", exact: true })).toBeVisible()
      await summary.getByRole("button", { name: "existing-checkout", exact: true }).click()
      await expect(page.getByRole("menuitem", { name: "Local repository", exact: true })).toBeEnabled()
      await page.keyboard.press("Escape")
      await page.keyboard.press("Escape")
      await expect(prompt).toHaveText("Keep this draft")
      await expect(page.getByText("Review this change", { exact: true })).toBeVisible()
      expect(creations).toEqual([])
    })
  }
}

async function openDetails(page: Page, mobile: boolean) {
  if (mobile) {
    await page
      .locator('[data-slot="session-mobile-view-navigation"]')
      .getByRole("button", { name: "More options", exact: true })
      .click()
    await page.getByRole("menuitem", { name: "Session details", exact: true }).click()
    return
  }
  await page.getByRole("button", { name: "Session details", exact: true }).click()
}
