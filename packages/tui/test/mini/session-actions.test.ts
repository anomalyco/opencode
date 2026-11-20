import { expect, test } from "bun:test"
import { SESSION_ACTIONS, runSessionCommand } from "../../src/mini/session-actions"
import type { FooterEvent, RunInput, RunPicker, StreamCommit } from "../../src/mini/types"
import { createFooterApiFixture } from "./fixture/footer-api"

function setup(sdk: object) {
  const events: FooterEvent[] = []
  const commits: StreamCommit[] = []
  const calls: string[] = []
  const footer = createFooterApiFixture({ events, commits }).api
  footer.onPrompt((prompt) => calls.push(`submit ${prompt.text}`))
  const deps = {
    sdk: () => sdk as unknown as RunInput["sdk"],
    sessionID: () => "ses_current",
    directory: () => "/project",
    footer,
    open: async (id: string) => {
      calls.push(`open ${id}`)
    },
    retitle: (title: string) => {
      calls.push(`retitle ${title}`)
    },
  }
  const run = (text: string) => runSessionCommand(deps, text)
  const texts = () => commits.map((commit) => commit.text)
  const picker = () => events.find((event): event is Extract<FooterEvent, { type: "picker" }> => event.type === "picker")
    ?.picker as RunPicker
  return { run, calls, events, commits, texts, picker }
}

const user = { type: "user", id: "msg_1", text: "fix the bug", files: [], agents: [], skills: [] }

test("every menu action maps to a slash command the runtime handles", () => {
  expect(SESSION_ACTIONS.map((action) => action.command)).toEqual(["sessions", "rename", "fork", "undo", "redo", "mcp"])
})

test("rename updates the title and the terminal title", async () => {
  const updates: unknown[] = []
  const test = setup({ session: { update: async (input: unknown) => updates.push(input) } })
  await test.run("/rename New name")
  expect(updates).toEqual([{ sessionID: "ses_current", title: "New name" }])
  expect(test.calls).toEqual(["retitle New name"])
  await test.run("/rename")
  expect(test.texts().at(-1)).toContain("usage")
})

test("fork opens the new session", async () => {
  const test = setup({ session: { fork: async () => ({ id: "ses_forked" }) } })
  await test.run("/fork")
  expect(test.calls).toEqual(["open ses_forked"])
})

test("undo stages the revert and puts the message back in the prompt", async () => {
  const steps: string[] = []
  const test = setup({
    message: { list: async () => ({ data: [user] }) },
    session: {
      get: async () => ({}),
      interrupt: async () => steps.push("interrupt"),
      wait: async () => steps.push("wait"),
      revert: { stage: async (input: { messageID: string }) => steps.push(`stage ${input.messageID}`) },
    },
  })
  await test.run("/undo")
  expect(steps).toEqual(["interrupt", "wait", "stage msg_1"])
  expect(test.events).toContainEqual({ type: "prefill", prompt: { text: "fix the bug", parts: [] } })
})

test("undo again skips the message already staged for revert", async () => {
  const staged: string[] = []
  const test = setup({
    message: { list: async () => ({ data: [{ ...user, id: "msg_2", text: "second" }, user] }) },
    session: {
      get: async () => ({ revert: { messageID: "msg_2" } }),
      interrupt: async () => {},
      wait: async () => {},
      revert: { stage: async (input: { messageID: string }) => staged.push(input.messageID) },
    },
  })
  await test.run("/undo")
  expect(staged).toEqual(["msg_1"])
})

test("undo with no messages says so, and redo clears the revert", async () => {
  const cleared: unknown[] = []
  const test = setup({
    message: { list: async () => ({ data: [] }) },
    session: { get: async () => ({}), revert: { clear: async (input: unknown) => cleared.push(input) } },
  })
  await test.run("/undo")
  expect(test.texts()).toEqual(["nothing to undo"])
  await test.run("/redo")
  expect(cleared).toEqual([{ sessionID: "ses_current" }])
})

test("the session picker lists sessions and opens the chosen one", async () => {
  const test = setup({
    session: {
      list: async () => ({
        data: [
          { id: "ses_current", title: "Now", time: { updated: 1 } },
          { id: "ses_old", title: "", time: { updated: 2 } },
        ],
      }),
    },
  })
  await test.run("/sessions")
  const picker = test.picker()
  expect((await picker.load()).map((item) => [item.id, item.display, item.current])).toEqual([
    ["ses_current", "Now", true],
    ["ses_old", "ses_old", false],
  ])
  await picker.onSelect("ses_old")
  expect(test.calls).toEqual(["submit /sessions ses_old"])
  await test.run("/sessions ses_current")
  await test.run("/sessions ses_old")
  expect(test.calls).toEqual(["submit /sessions ses_old", "open ses_old"])
})

test("the MCP picker toggles servers and explains the ones that need auth", async () => {
  const toggled: string[] = []
  const status = { a: "connected", b: "failed", c: "needs_auth" } as Record<string, string>
  const test = setup({
    mcp: {
      list: async () => ({ data: Object.entries(status).map(([name, status]) => ({ name, status: { status } })) }),
      connect: async (input: { server: string }) => toggled.push(`connect ${input.server}`),
      disconnect: async (input: { server: string }) => toggled.push(`disconnect ${input.server}`),
    },
  })
  await test.run("/mcp")
  const picker = test.picker()
  expect((await picker.load()).map((item) => [item.id, item.footer])).toEqual([
    ["a", "connected"],
    ["b", "failed"],
    ["c", "needs_auth"],
  ])
  for (const name of ["a", "b", "c"]) {
    await picker.onSelect(name)
    await Bun.sleep(0)
  }
  expect(toggled).toEqual(["disconnect a", "connect b"])
  expect(test.texts().at(-1)).toContain("needs authentication")
})

test("failures are printed as errors instead of thrown", async () => {
  const test = setup({ session: { fork: async () => Promise.reject(new Error("offline")) } })
  await test.run("/fork")
  expect(test.commits.at(-1)).toMatchObject({ kind: "error", text: "offline" })
})
