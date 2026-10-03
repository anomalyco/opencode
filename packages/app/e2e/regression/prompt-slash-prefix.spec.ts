import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import pkg from "../../package.json" with { type: "json" }

const directory = "C:/OpenCode/PromptSlashPrefix"
const projectID = "proj_prompt_slash_prefix"
const sessionID = "ses_prompt_slash_prefix"

const cases = [
  { name: "the start", draft: "已有文字", cursor: 0 },
  { name: "the middle", draft: "已有文字", cursor: 2 },
  { name: "the end", draft: "已有文字", cursor: 4 },
  { name: "a multiline position", draft: "第一行\n第二行", cursor: 7 },
]

for (const layout of [false, true]) {
  for (const item of cases) {
    test(`inserting a slash at ${item.name} opens skills (${layout ? "v2" : "legacy"})`, async ({ page }) => {
      const draft = item.draft
      await mockOpenCodeServer(page, {
        directory,
        project: {
          id: projectID,
          worktree: directory,
          vcs: "git",
          name: "prompt-slash-prefix",
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
            slug: "prompt-slash-prefix",
            projectID,
            directory,
            title: "Prompt slash prefix",
            version: "dev",
            time: { created: 1700000000000, updated: 1700000000000 },
          },
        ],
        pageMessages: () => ({ items: [] }),
      })
      await page.route(
        (url) => url.pathname === "/command",
        (route) =>
          route.fulfill({
            json: [
              { name: "test-skill", description: "Test skill", template: "Test skill", hints: [], source: "skill" },
            ],
            headers: { "access-control-allow-origin": "*" },
          }),
      )
      await page.route(
        (url) => /^\/(?:api\/)?session\/[^/]+\/command$/.test(url.pathname),
        (route) => route.fulfill({ json: {}, headers: { "access-control-allow-origin": "*" } }),
      )
      // Keep the legacy layout available before its September 14, 2026 sunset.
      if (!layout) await page.clock.setFixedTime(new Date("2026-09-01T12:00:00Z"))
      await page.addInitScript(
        (input) => {
          localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: input.layout } }))
          localStorage.setItem("app-version.v1", JSON.stringify({ version: input.version }))
        },
        { layout, version: pkg.version },
      )

      await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
      const input = page.locator('[data-component="prompt-input"][contenteditable="true"]')
      const skill = page.locator(
        layout ? '[data-suggestion-id="custom.test-skill"]' : '[data-slash-id="custom.test-skill"]',
      )
      await expectAppVisible(input)
      await expect(input).toBeEditable()

      await input.fill("/")
      await expect(skill).toBeVisible()
      await input.press("Escape")
      await input.fill("")
      for (const [index, line] of draft.split("\n").entries()) {
        if (index > 0) await input.press("Shift+Enter")
        await input.pressSequentially(line)
      }
      await expect(input).toHaveText(draft, { useInnerText: true })
      for (let index = draft.length; index > item.cursor; index--) await input.press("ArrowLeft")
      await input.press("/")

      const before = draft.slice(0, item.cursor)
      const after = draft.slice(item.cursor)
      await expect(input).toHaveText(`${before}/${after}`, { useInnerText: true })
      await expect(skill).toBeVisible()
      await input.pressSequentially("test")
      await expect(skill).toBeVisible()
      if (draft.includes("\n")) await input.press("Tab")
      if (!draft.includes("\n")) await skill.click()
      await expect(input).toHaveText(`${before}/test-skill ${after}`, { useInnerText: true })
      const token = input.locator(layout ? '[data-mention="command"]' : '[data-type="command"]')
      await expect(token).toHaveText("/test-skill")
      await expect(token).toHaveCSS("color", "rgb(69, 130, 204)")
      await expect(skill).toBeHidden()

      const sent = page.waitForRequest(
        (request) =>
          request.method() === "POST" && /^\/(?:api\/)?session\/[^/]+\/command$/.test(new URL(request.url()).pathname),
      )
      await page.locator('[data-action="prompt-submit"]').click()
      const request = await sent
      expect(request.postDataJSON()).toMatchObject({
        command: "test-skill",
        arguments: [before.trimEnd(), after.trimStart()].filter(Boolean).join(" "),
      })
    })
  }
}
