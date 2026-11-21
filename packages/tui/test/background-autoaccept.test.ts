import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

async function fixture(mode: "prompt" | "autoaccept", target: "root" | "child" = "root") {
  const state = await tmpdir()
  const file = path.join(state.path, "test", "tui", "tabs.json")
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    JSON.stringify({
      global: { tabs: [{ sessionID: "root", title: "Background session" }], unread: {} },
      cwd: {},
    }),
  )
  const session = (id: "root" | "child") => ({
    id,
    parentID: id === "child" ? "root" : undefined,
    title: id === "root" ? "Background session" : "Child session",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  })
  const permission = { id: "per_command", sessionID: target, action: "shell", resources: ["git status"] }
  const replies: { decision: string }[] = []
  const replied = Promise.withResolvers<void>()
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    state: state.path,
    config: { animations: false, tabs: { mode: "on", scope: "global" }, session: { permissions: mode } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session" && url.searchParams.get("parentID") === "root")
        return json({ data: [session("child")], cursor: {} })
      if (url.pathname === "/api/session/root") return json({ data: session("root") })
      if (url.pathname === "/api/session/child") return json({ data: session("child") })
      if (url.pathname === `/api/session/${target}/permission`)
        return json({ data: replies.length ? [] : [permission] })
      if (url.pathname === `/api/session/${target}/permission/per_command/reply` && request.method === "POST") {
        replies.push(await request.json())
        replied.resolve()
        return new Response(null, { status: 204 })
      }
      if (/^\/api\/session\/[^/]+\/message$/.test(url.pathname)) return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/inbox$/.test(url.pathname)) return json({ data: [] })
      return undefined
    },
  })
  return {
    ...setup,
    replies,
    replied: replied.promise,
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
      await state[Symbol.asyncDispose]()
    },
  }
}

test.each(["root", "child"] as const)(
  "autoaccept approves a background %s without selecting its tab",
  async (target) => {
    await using setup = await fixture("autoaccept", target)
    await setup.ready
    await setup.replied
    await setup.waitForFrame((frame) => frame.includes("New session") && !frame.includes("! Background"))
    expect(setup.replies).toEqual([{ decision: "once" }])
  },
)

test("prompt mode keeps a background request pending until manual approval", async () => {
  await using setup = await fixture("prompt")
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("! Background"))

  // Wait for the pending request to survive navigation and appear in the approval UI.
  setup.mockInput.pressKey("1", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Permission required") && frame.includes("git status"))
  expect(setup.replies).toEqual([])

  setup.mockInput.pressEnter()
  await setup.replied
  await setup.waitForFrame((frame) => !frame.includes("Permission required"))
  expect(setup.replies).toEqual([{ decision: "once" }])
})
