import { expect, test } from "@playwright/test"
import { currentSession, mockOpenCodeServer } from "../utils/mock-server"

const directory = "/fixture/first-prompt"
const projectID = "proj_first_prompt"
const text = "Keep the composer visible while opening this session."

test.use({ serviceWorkers: "block" })

for (const input of ["keyboard", "pointer"] as const) {
  test(`retains the draft during a cold first prompt from ${input}`, async ({ page }, testInfo) => {
    const sessions: ReturnType<typeof currentSession>[] = []
    const prompts: { sessionID: string; body: Record<string, unknown> }[] = []
    await mockOpenCodeServer(page, {
      directory,
      project: { id: projectID, worktree: directory, name: "first-prompt", vcs: "git", sandboxes: [] },
      provider: {
        all: [{ id: "opencode", name: "OpenCode", models: { fixture: { id: "fixture", name: "Fixture Model" } } }],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "fixture" },
      },
      sessions,
      pageMessages: () => ({ items: [] }),
      onPrompt: (prompt) => prompts.push(prompt),
    })
    await page.route("**/api/session", (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      const session = currentSession({ ...route.request().postDataJSON(), projectID, title: "First prompt" }, directory)
      sessions.push(session)
      return route.fulfill({ json: { data: session } })
    })
    await page.addInitScript((directory) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
    }, directory)

    // The session route awaits the file viewer chunk. Keep that real import pending
    // until the test has inspected the draft; do not add timing-dependent sleeps.
    const requested = Promise.withResolvers<void>()
    const loaded = Promise.withResolvers<void>()
    await page.route(
      /(?:\/_assets\/file-(?!icon-)[^/]+\.js|\/session-ui\/src\/components\/file\.tsx)(?:\?|$)/,
      async (route) => {
        requested.resolve()
        await loaded.promise
        await route.continue()
      },
    )

    await page.goto("/")
    await page.locator('[data-action="home-new-session"]').click()
    const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(editor).toBeEditable()
    await expect(page.locator('[data-action="composer-model"]')).toHaveText("Fixture Model")
    await editor.fill(text)
    await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()
    const observation = await page.evaluateHandle(() => {
      const frames: { visible: boolean; time: number }[] = []
      const start = performance.now()
      let frame = 0
      const sample = () => {
        const editor = document.querySelector<HTMLElement>('[data-component="composer-editor"]')
        frames.push({
          visible: !!editor?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
          time: performance.now() - start,
        })
        frame = requestAnimationFrame(sample)
      }
      sample()
      return {
        stop: () => {
          cancelAnimationFrame(frame)
          return frames
        },
      }
    })

    try {
      if (input === "keyboard") await editor.press("Enter")
      if (input === "pointer") await page.locator('[data-action="composer-submit"]').click()
      await requested.promise
      await expect(editor).toBeVisible()
      await expect(editor).toHaveText(text)
      await testInfo.attach("loading-session", { body: await page.screenshot(), contentType: "image/png" })
    } finally {
      loaded.resolve()
    }

    await expect(page).toHaveURL(/\/session\/ses_/)
    await expect.poll(() => prompts).toEqual([{ sessionID: sessions[0]!.id, body: expect.objectContaining({ text }) }])
    await expect(editor).toHaveText("")
    await expect(editor).toBeEditable()
    await expect(page.locator('[data-action="composer-model"]')).toHaveText("Fixture Model")
    const frames = await observation.evaluate((observation) => observation.stop())
    await observation.dispose()
    await testInfo.attach("composer-frames", { body: JSON.stringify(frames), contentType: "application/json" })
    expect(frames.length).toBeGreaterThan(0)
    expect(
      frames.filter((frame) => !frame.visible),
      "composer must remain visible through the route handoff",
    ).toEqual([])
    await page.keyboard.type("Follow-up")
    await expect(editor).toHaveText("Follow-up")
    await expect(editor).toBeFocused()
  })
}
