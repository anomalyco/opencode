import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "/repo/slash-skills"
const projectID = "proj_slash_skills"
const sessionID = "ses_slash_skills"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

async function setup(page: Page, queued = false) {
  const prompts: Record<string, unknown>[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "slash-skills",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        projectID,
        directory,
        title: "Slash skills",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    sessionStatus: queued ? { [sessionID]: { type: "running" } } : {},
    inbox: queued
      ? [
          {
            id: "inb_slash_skill",
            sessionID,
            timeCreated: 1700000000000,
            type: "user",
            payload: { text: "Explain caching" },
            delivery: "queue",
          },
        ]
      : [],
    findFiles: ({ query }) =>
      query.includes("cache")
        ? [
            {
              name: "cache.ts",
              path: "src/cache.ts",
              absolute: `${directory}/src/cache.ts`,
              type: "file",
              ignored: false,
            },
          ]
        : [],
    onPrompt: ({ body }) => prompts.push(body),
  })
  await page.route("**/api/skill?*", (route) =>
    route.fulfill({
      json: {
        location: { directory, project: { id: projectID, directory, canonical: directory } },
        data: [
          { id: "show-me", slash: true, autoinvoke: false },
          { id: "hidden", slash: false },
          { id: "implicit" },
          { id: "review", slash: true },
          { id: "model", slash: true },
        ].map((skill) => ({
          name: skill.id === "show-me" ? "Show Me" : skill.id,
          description: "Explain the current topic visually",
          location: `/skills/${skill.id}/SKILL.md`,
          content: "Explain visually",
          ...skill,
        })),
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  )
  await page.route("**/api/command?*", (route) =>
    route.fulfill({
      json: {
        location: { directory, project: { id: projectID, directory, canonical: directory } },
        data: [{ name: "review", description: "Review changes" }],
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  )
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  const composer = page.locator('[data-component="composer"]')
  const editor = composer.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()
  return { prompts, composer, editor }
}

for (const selection of ["keyboard", "pointer"]) {
  test(`selects and submits a manual-only slash skill with ${selection}`, async ({ page }) => {
    const { prompts, editor } = await setup(page)
    await editor.fill("/show")
    const skill = page.locator('[data-suggestion-id="skill:show-me"]')
    await expect(skill).toContainText("/show-me")
    await page.screenshot({ path: test.info().outputPath("slash-menu.png") })
    if (selection === "keyboard") await editor.press("Enter")
    if (selection === "pointer") await skill.click()
    await expect(editor).toHaveText("/show-me ")
    await expect(editor).toBeFocused()
    await editor.pressSequentially("explain caching")
    await editor.press("Enter")
    await expect.poll(() => prompts.length).toBe(1)
    expect(prompts[0]).toMatchObject({
      text: "/show-me explain caching",
      skills: [{ id: "show-me", mention: { start: 0, end: 8, text: "/show-me" } }],
    })
    await expect(editor).toBeEmpty()
  })
}

test("respects slash flags and command precedence without hiding context skills", async ({ page }) => {
  const { editor } = await setup(page)
  await editor.fill("/")
  await expect(page.locator('[data-suggestion-id="skill:show-me"]')).toBeVisible()
  await expect(page.locator('[data-suggestion-id="custom.review"]')).toBeVisible()
  await expect(page.locator('[data-suggestion-id="model.choose"]')).toBeVisible()
  for (const id of ["hidden", "implicit", "review", "model"]) {
    await expect(page.locator(`[data-suggestion-id="skill:${id}"]`)).toHaveCount(0)
  }
  await editor.press("Escape")
  await expect(page.locator('[data-suggestion-id="skill:show-me"]')).toHaveCount(0)
  await expect(editor).toBeFocused()
  await editor.fill("@hidden")
  const hidden = page.locator('[data-suggestion-id="skill:hidden"]')
  await expect(hidden).toContainText("@hidden")
  await hidden.click()
  await expect(editor).toHaveText("@hidden ")
  await expect(editor).toBeFocused()
})

test("preserves structured attachments when adding a slash skill from the command menu", async ({ page }) => {
  const { prompts, composer, editor } = await setup(page)
  await editor.fill("explain @cache")
  const file = page.locator('[data-suggestion-id="file:src/cache.ts"]')
  await expect(file).toBeVisible()
  await file.click()
  await expect(editor).toHaveText("explain @src/cache.ts ")
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Commands" }).click()
  const skill = page.locator('[data-suggestion-id="skill:show-me"]')
  await expect(skill).toBeVisible()
  await skill.click()
  await expect(editor).toHaveText("/show-me explain @src/cache.ts ")
  await expect(editor).toBeFocused()
  await editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]).toMatchObject({
    skills: [{ id: "show-me", mention: { start: 0, end: 8, text: "/show-me" } }],
    files: [{ name: "cache.ts", mention: { start: 17, end: 30, text: "@src/cache.ts" } }],
  })
})

for (const select of [true, false]) {
  test(`keeps slash skills in queued edits (${select ? "selected" : "typed"})`, async ({ page }) => {
    const { prompts, editor } = await setup(page, true)
    const row = page.locator('[data-component="session-queue-row"]')
    await row.getByText("Explain caching", { exact: true }).click()
    await expect(editor).toHaveText("Explain caching")
    if (select) {
      await editor.fill("/show")
      const skill = page.locator('[data-suggestion-id="skill:show-me"]')
      await expect(skill).toBeVisible()
      await skill.click()
      await expect(editor).toHaveText("/show-me ")
      await editor.pressSequentially("explain caching")
    }
    if (!select) await editor.fill("/show-me explain caching")
    await editor.press("Enter")
    await expect.poll(() => prompts.length).toBe(1)
    expect(prompts[0]).toMatchObject({
      delivery: "queue",
      text: "/show-me explain caching",
      skills: [{ id: "show-me", mention: { start: 0, end: 8, text: "/show-me" } }],
    })
  })
}
