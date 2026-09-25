import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

test("a launch createSessionID seeds the first fresh session and is consumed once", async () => {
  const created: { id?: string; location?: { directory: string } }[] = []
  const submitted = Promise.withResolvers<string>()
  let notify = 0
  const location = {
    directory: "/tmp/opencode/packages/tui",
    project: { id: "project", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
  }
  await using setup = await createAppFixture({
    args: { createSessionID: "ses_chosen" },
    config: { animations: false, keybinds: { "session.new": "f6" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const input: unknown = await request.json()
        if (typeof input !== "object" || input === null) throw new Error("Expected a session input")
        const record = input as { id?: string; location?: { directory: string } }
        created.push(record)
        return json({
          data: {
            ...record,
            projectID: "project",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        notify++
        if (notify === 1) submitted.resolve(url.pathname.split("/")[3] ?? "")
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(agent|model)$/.test(url.pathname)) return new Response(null, { status: 204 })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) {
        const id = url.pathname.split("/")[3]
        const record = created.find((item) => item.id === id)
        if (!record) return json({ message: "not found" }, { status: 404 })
        return json({
          data: {
            ...record,
            location: record.location ?? { directory: location.directory },
            projectID: "project",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      }
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  expect(
    await Promise.race([
      submitted.promise,
      Bun.sleep(4_000).then(() => {
        throw new Error(
          `prompt was not submitted; created: ${JSON.stringify(created)}; frame:\n${setup.captureCharFrame()}`,
        )
      }),
    ]),
  ).toBe("ses_chosen")
  expect(created).toHaveLength(1)
  expect(created[0]?.id).toBe("ses_chosen")

  setup.mockInput.pressKey("F6")
  await setup.renderOnce()
  await setup.mockInput.typeText("again")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => created.length === 2)
  expect(created[1]?.id).toMatch(/^ses/)
  expect(created[1]?.id).not.toBe("ses_chosen")
})
