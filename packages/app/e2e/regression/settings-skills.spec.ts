import { expect, test, type Locator, type Page } from "@playwright/test"
import { Preferences } from "@opencode-ai/schema/preferences"
import { base64Encode } from "@opencode-ai/util/encode"
import { Schema } from "effect"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

const directory = "/repo/skill-preferences"
const sessionID = "ses_skill_preferences"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const shared = { id: "show-me", name: "Show Me" }
const local = { id: "local-review", name: "مراجعة Local Review" }
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
}

for (const direction of ["ltr", "rtl"]) {
  test(`skill switches in global and project settings update the composer (${direction})`, async ({ page }) => {
    const fixture = await setup(page)
    await page.evaluate((dir) => {
      document.documentElement.dir = dir
    }, direction)
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
    await settings.getByRole("tab", { name: "Skills", exact: true }).click()
    await expect(switchInput(settings, shared.name)).toBeChecked()
    await switchControl(settings, shared.name).click()
    await expect(switchInput(settings, shared.name)).not.toBeChecked()
    await expect(settings.getByText("Disabled", { exact: true })).toBeVisible()
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()

    const editor = page.locator('[data-component="composer-editor"]')
    await expect(editor).toBeEditable()
    await editor.fill("/")
    await expect(page.locator('[data-suggestion-id="skill:local-review"]')).toBeVisible()
    await expect(page.locator('[data-suggestion-id="skill:show-me"]')).toHaveCount(0)
    await editor.fill("@")
    await expect(page.locator('[data-suggestion-id="skill:local-review"]')).toBeVisible()
    await expect(page.locator('[data-suggestion-id="skill:show-me"]')).toHaveCount(0)
    await editor.press("Escape")
    await editor.fill("")

    await page.keyboard.press("Control+,")
    await settings.getByRole("tab", { name: "Projects", exact: true }).click()
    await settings.getByText("Skill preferences", { exact: true }).click()
    const project = page.getByRole("dialog")
    await project.getByRole("tab", { name: "Extensions", exact: true }).click()
    await project.getByRole("tab", { name: "Skills", exact: true }).click()
    await expect(switchInput(project, local.name)).toBeChecked()
    await project.getByRole("button", { name: "Shared with all projects" }).click()
    await expect(switchInput(project, shared.name)).not.toBeChecked()
    await switchInput(project, shared.name).press("Space")
    await expect(switchInput(project, shared.name)).toBeChecked()
    await switchControl(project, local.name).click()
    await expect(switchInput(project, local.name)).not.toBeChecked()
    expect(fixture.writes).toEqual([
      { target: { kind: "skill.activation", id: shared.id }, value: "disabled" },
      { target: { kind: "skill.activation", id: shared.id }, value: "enabled" },
      { target: { kind: "skill.activation", id: local.id }, value: "disabled" },
    ])
    await page.keyboard.press("Escape")
    await expect(project).toBeHidden()
    await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
    await settings.getByRole("tab", { name: "Skills", exact: true }).click()
    await expect(switchInput(settings, shared.name)).toBeChecked()
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(editor).toBeEditable()
    await editor.fill("/")
    await expect(page.locator('[data-suggestion-id="skill:show-me"]')).toBeVisible()
    await expect(page.locator('[data-suggestion-id="skill:local-review"]')).toHaveCount(0)
  })
}

test("skill switches retain the saved state after a failed write and allow retry", async ({ page }) => {
  const fixture = await setup(page)
  const release = Promise.withResolvers<void>()
  await page.route(
    "**/api/preferences/skill.activation/show-me",
    async (route) => {
      await release.promise
      await route.fulfill({ status: 503, headers, json: { message: "Unavailable" } })
    },
    { times: 1 },
  )
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
  await settings.getByRole("tab", { name: "Skills", exact: true }).click()
  await expect(switchInput(settings, shared.name)).toBeChecked()
  await switchControl(settings, shared.name).click()
  await expect(switchInput(settings, shared.name)).toBeDisabled()
  release.resolve()
  await expect(page.getByText("Could not update Show Me. Please try again.", { exact: true })).toBeVisible()
  await expect(switchInput(settings, shared.name)).toBeEnabled()
  await expect(switchInput(settings, shared.name)).toBeChecked()
  expect(fixture.writes).toEqual([])
  await switchControl(settings, shared.name).click()
  await expect(switchInput(settings, shared.name)).not.toBeChecked()
  expect(fixture.writes).toHaveLength(1)
})

test("external preference changes update skill settings and suggestions without reloading definitions", async ({
  page,
}) => {
  const fixture = await setup(page)
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
  await settings.getByRole("tab", { name: "Skills", exact: true }).click()
  await expect(switchInput(settings, shared.name)).toBeChecked()
  const reads = fixture.state.skillReads
  fixture.state.preferences = [{ target: { kind: "skill.activation", id: shared.id }, value: "disabled" }]
  await fixture.transport.send({
    id: "evt_skill_disabled",
    created: 1700000001000,
    type: "preferences.updated",
    data: { target: { kind: "skill.activation", id: shared.id } },
  })
  await expect(switchInput(settings, shared.name)).not.toBeChecked()
  expect(fixture.state.skillReads).toBe(reads)
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()
  await editor.fill("/")
  await expect(page.locator('[data-suggestion-id="skill:local-review"]')).toBeVisible()
  await expect(page.locator('[data-suggestion-id="skill:show-me"]')).toHaveCount(0)
})

function switchInput(scope: Locator, name: string) {
  return scope.getByRole("switch", { name: `Enable ${name}`, exact: true })
}

function switchControl(scope: Locator, name: string) {
  return scope
    .locator('[data-component="switch"]')
    .filter({ has: scope.page().getByRole("switch", { name: `Enable ${name}`, exact: true }) })
    .locator('[data-slot="switch-control"]')
}

async function setup(page: Page) {
  const transport = await installSseTransport(page, { server })
  const state = { preferences: [] as Preferences.Entry[], skillReads: 0 }
  const writes: Preferences.Entry[] = []
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, name: "Skill preferences", expanded: true }] },
      }),
    )
  }, directory)
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_skill_preferences",
      canonical: directory,
      name: "Skill preferences",
      vcs: "git",
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
        projectID: "proj_skill_preferences",
        directory,
        title: "Skill preferences session",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.route(
    (url) => url.pathname === "/api/location",
    (route) => {
      const current = new URL(route.request().url()).searchParams.get("location[directory]") ?? ""
      return route.fulfill({
        headers,
        json: {
          directory: current,
          project: { id: current ? "proj_skill_preferences" : "global", directory: current, canonical: current },
        },
      })
    },
  )
  await page.route(
    (url) => url.pathname === "/api/skill",
    (route) => {
      state.skillReads += 1
      const project = new URL(route.request().url()).searchParams.get("location[directory]") === directory
      return route.fulfill({
        headers,
        json: {
          location: { directory: project ? directory : "" },
          data: (project ? [shared, local] : [shared]).map((skill) => ({
            ...skill,
            slash: true,
            autoinvoke: false,
            description: "Skill preferences fixture",
            content: "Review the code",
            location: `${directory}/${skill.id}/SKILL.md`,
          })),
        },
      })
    },
  )
  await page.route(
    (url) => url.pathname.startsWith("/api/preferences"),
    (route) => {
      const request = route.request()
      const url = new URL(request.url())
      expect(url.origin).toBe(server)
      expect(url.search).toBe("")
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers })
      if (request.method() === "GET") return route.fulfill({ json: state.preferences, headers })
      expect(request.method()).toBe("PUT")
      const entry = Schema.decodeUnknownSync(Preferences.Entry)({
        target: {
          kind: "skill.activation",
          id: decodeURIComponent(url.pathname.slice("/api/preferences/skill.activation/".length)),
        },
        ...request.postDataJSON(),
      })
      writes.push(entry)
      state.preferences = [...state.preferences.filter((item) => item.target.id !== entry.target.id), entry]
      return route.fulfill({ status: 204, headers })
    },
  )
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await transport.waitForConnection()
  return { state, writes, transport }
}
