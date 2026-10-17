import { expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const command = "printf shell-admission-fixture"
const sessionTemplate = {
  id: "ses_shell_rejection",
  title: "Admission rejection fixture",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

test.each([false, true])("rejected existing-session shell preserves newer draft: %s", async (newerDraft) => {
  const session = { ...sessionTemplate, id: `ses_shell_rejection_${crypto.randomUUID()}` }
  const loaded = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<{ command: string }>()
  const response = Promise.withResolvers<Response>()
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" }, session: { sidebar: "hide" } },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) {
        loaded.resolve()
        return json({ data: session })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location: { directory }, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/model")
        return json({ location: { directory }, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
      if (url.pathname === "/api/provider") return json({ location: { directory }, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === `/api/session/${session.id}/shell` && request.method === "POST") {
        requested.resolve(await request.json())
        const reply = await response.promise
        return reply
      }
      return undefined
    },
  })
  await setup.ready
  await loaded.promise
  await setup.waitForFrame(
    (frame) => frame.includes("Model") && setup.renderer.currentFocusedEditor !== undefined,
  )
  await setup.mockInput.typeText("!")
  await setup.waitForFrame((frame) => frame.includes("Shell"))
  await setup.mockInput.typeText(command)
  setup.mockInput.pressEnter()
  expect(await requested.promise).toEqual({ command })
  await setup.waitForFrame(() => setup.renderer.currentFocusedEditor?.plainText === "")
  if (newerDraft) await setup.mockInput.typeText("newer unsent draft")
  response.resolve(json({ message: "shell admission rejected" }, { status: 400 }))
  const frame = await setup.waitForFrame((frame) => frame.includes("Failed to run shell command"))
  const draft = setup.renderer.currentFocusedEditor?.plainText
  expect(draft).toBe(newerDraft ? "newer unsent draft" : command)
  if (newerDraft) expect(frame).not.toContain("Shell")
  else expect(frame).toContain("Shell")
})
