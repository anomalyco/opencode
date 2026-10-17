import { Session } from "@opencode/schema/session"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { PendingCommands } from "../src/component/prompt/pending-command"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { agent, model, session } from "./fixture/local"
import { directory, json } from "./fixture/tui-client"

const sessionID = Session.ID.make("ses_pending_create", { disableChecks: true })
const selection = { providerID: Provider.ID.make("provider"), id: Model.ID.make("first") }

async function launch() {
  PendingCommands.clear()
  takeDraft(undefined)
  takeDraft(sessionID)
  const created = Promise.withResolvers<Response>()
  const environment = Promise.withResolvers<Response>()
  const command = Promise.withResolvers<Response>()
  const calls: string[] = []
  const setup = await createAppFixture({
    args: { newSessionID: sessionID },
    environment: { PENDING_TEST: "value" },
    config: { animations: false, tabs: { enabled: false } },
    fetch: async (url, request) => {
      const location = { directory }
      if (url.pathname === "/api/agent") return json({ location, data: [agent("build")] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model") return json({ location, data: [model("first")] })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "mcp-slow", description: "Slow MCP prompt" }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        calls.push("create")
        expect((await request.json()).id).toBe(sessionID)
        return created.promise
      }
      if (url.pathname.endsWith("/environment") && request.method === "PUT") {
        calls.push("environment")
        expect(await request.json()).toEqual({ variables: { PENDING_TEST: "value" } })
        return environment.promise
      }
      if (url.pathname.endsWith("/command") && request.method === "POST") {
        calls.push("command")
        expect(await request.json()).toMatchObject({ name: "mcp-slow", text: "new session arguments" })
        return command.promise
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission|family)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) return json({ data: session(sessionID, selection) })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("first Provider"))
  await setup.mockInput.typeText("/mcp-slow new session arguments")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => calls.includes("create") && frame.includes("Resolving /mcp-slow"))
  return {
    setup,
    calls,
    created,
    environment,
    command,
    async [Symbol.asyncDispose]() {
      created.resolve(json({ data: session(sessionID, selection) }))
      environment.resolve(new Response(null, { status: 204 }))
      command.resolve(new Response(null, { status: 204 }))
      await setup[Symbol.asyncDispose]()
    },
  }
}

test("new-session command stays pending throughout creation, environment setup and MCP resolution", async () => {
  await using run = await launch()
  const setup = run.setup

  expect(PendingCommands.list(sessionID)).toHaveLength(1)
  expect(run.calls).toEqual(["create"])
  expect(setup.renderer.currentFocusedEditor?.plainText).toBe("")

  run.created.resolve(json({ data: session(sessionID, selection) }))
  await setup.waitForFrame((frame) => run.calls.includes("environment") && frame.includes("Resolving /mcp-slow"))
  expect(run.calls).not.toContain("command")
  expect(PendingCommands.list(sessionID)).toHaveLength(1)

  run.environment.resolve(new Response(null, { status: 204 }))
  await setup.waitForFrame((frame) => run.calls.includes("command") && frame.includes("Resolving /mcp-slow"))
  expect(run.calls.filter((call) => call === "command")).toHaveLength(1)
  run.command.resolve(new Response(null, { status: 204 }))
  await setup.waitForFrame((frame) => !frame.includes("Resolving /mcp-slow"))
  expect(PendingCommands.list(sessionID)).toEqual([])
})

for (const phase of ["create", "environment"] as const) {
  for (const newerDraft of [false, true]) {
    test(`new-session ${phase} failure clears pending and restores ${newerDraft ? "newer" : "submitted"} draft`, async () => {
      await using run = await launch()
      const setup = run.setup
      if (phase === "environment") {
        run.created.resolve(json({ data: session(sessionID, selection) }))
        await setup.waitForFrame(() => run.calls.includes("environment"))
      }
      const textarea = setup.renderer.currentFocusedEditor
      if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused prompt")
      if (newerDraft) {
        textarea.setText("keep my newer draft")
        await setup.renderOnce()
      }
      const gate = phase === "create" ? run.created : run.environment
      gate.resolve(json({ message: `${phase} failed` }, { status: 500 }))
      const expectedDraft = newerDraft ? "keep my newer draft" : "/mcp-slow new session arguments"
      await setup.waitForFrame((frame) => frame.includes(expectedDraft) && !frame.includes("Resolving /mcp-slow"))
      expect(PendingCommands.list(sessionID)).toEqual([])
      expect(run.calls).not.toContain("command")
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe(expectedDraft)
    })
  }
}
