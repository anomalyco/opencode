import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("Home and End navigate a subagent transcript", async () => {
  const session = {
    id: "ses_subagent_navigation",
    parentID: "ses_parent",
    title: "Subagent",
    agent: "build",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`,
    type: "user",
    text: `Message ${index}`,
    time: { created: index },
  }))
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    },
  })
  await setup.ready
  expect(
    await setup.waitForFrame((frame) => frame.includes("Message 19") && frame.includes("Subagents")),
  ).not.toContain("Message 0")
  setup.mockInput.pressKey("HOME")
  expect(await setup.waitForFrame((frame) => frame.includes("Message 0"))).not.toContain("Message 19")
  setup.mockInput.pressKey("END")
  expect(await setup.waitForFrame((frame) => frame.includes("Message 19"))).not.toContain("Message 0")
})

test("loads child prompts while older grouped history is pending", async () => {
  const root = {
    id: "ses_prompt_root",
    title: "Root",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const child = { ...root, id: "ses_prompt_child", parentID: root.id }
  const historyStarted = Promise.withResolvers<void>()
  const releaseHistory = Promise.withResolvers<void>()
  const permission = Promise.withResolvers<string>()
  const form = Promise.withResolvers<string>()
  let historyPending = false
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: root.id },
    fetch: async (url) => {
      if (url.pathname === "/api/session") return json({ data: [child], cursor: {} })
      if (url.pathname === `/api/session/${root.id}`) return json({ data: root })
      if (url.pathname === `/api/session/${root.id}/message`) {
        if (url.searchParams.has("cursor")) {
          historyPending = true
          historyStarted.resolve()
          await releaseHistory.promise
          return json({ data: [], cursor: {} })
        }
        return json({
          data: [
            {
              id: "msg_reasoning",
              type: "assistant",
              agent: "build",
              model: { providerID: "fixture", id: "fixture" },
              time: { created: 1, completed: 2 },
              content: [{ type: "reasoning", text: "Thinking", time: { created: 1, completed: 2 } }],
            },
          ],
          cursor: { next: "older" },
        })
      }
      if (url.pathname === `/api/session/${child.id}/permission`) permission.resolve("permission")
      if (url.pathname === `/api/session/${child.id}/form`) form.resolve("form")
      if (["inbox", "permission", "form"].some((name) => url.pathname === `/api/session/${root.id}/${name}`))
        return json({ data: [] })
      if (["permission", "form"].some((name) => url.pathname === `/api/session/${child.id}/${name}`))
        return json({ data: [] })
      return undefined
    },
  })
  try {
    await setup.ready
    const result = await Promise.race([
      Promise.all([historyStarted.promise, permission.promise, form.promise]),
      new Promise<never>((_, reject) => {
        const signal = AbortSignal.timeout(5000)
        signal.addEventListener(
          "abort",
          () => reject(new Error(`child prompt requests did not complete; older history pending: ${historyPending}`)),
          { once: true },
        )
      }),
    ])
    expect(result.slice(1)).toEqual(["permission", "form"])
  } finally {
    releaseHistory.resolve()
    await setup[Symbol.asyncDispose]()
  }
})
