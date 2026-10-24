import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"
import { json } from "../fixture/tui-client"

test("history submits workspace-relative files from the destination workspace", async () => {
  await using state = await tmpdir()
  const first = path.join(state.path, "workspace-a", "test")
  const second = path.join(state.path, "workspace-b", "test")
  await mkdir(path.dirname(first), { recursive: true })
  await mkdir(path.dirname(second), { recursive: true })
  await Bun.write(first, "content A\n")
  await Bun.write(second, "content B\n")
  const uri = pathToFileURL(first).href + "?start=1&end=1"
  const history = {
    text: "inspect @test#1",
    files: [{ uri, name: "test#1", workspaceRelative: "test", mention: { start: 8, end: 15, text: "@test#1" } }],
    agents: [],
    skills: [],
    pasted: [],
  }
  await Bun.write(path.join(state.path, "prompt-history.jsonl"), JSON.stringify(history) + "\n")
  const location = {
    directory: path.dirname(second),
    project: { id: "project", directory: path.dirname(second), canonical: path.dirname(second) },
  }
  const submitted = Promise.withResolvers<{ uri: string; content: string; metadata: boolean }>()
  let session: unknown
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    state: state.path,
    config: { animations: false, tabs: { mode: "off" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const input: unknown = await request.json()
        if (typeof input !== "object" || input === null) throw new Error("Expected session input")
        session = {
          ...input,
          projectID: "project",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        }
        return json({ data: session })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        const body = (await request.json()) as { files: Array<{ uri: string; workspaceRelative?: string }> }
        const attachment = body.files[0]
        if (!attachment) throw new Error("Expected submitted attachment")
        submitted.resolve({
          uri: attachment.uri,
          content: await Bun.file(fileURLToPath(new URL(attachment.uri))).text(),
          metadata: "workspaceRelative" in attachment,
        })
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (session && /^\/api\/session\/[^/]+$/.test(url.pathname)) return json({ data: session })
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  setup.mockInput.pressArrow("up")
  await setup.waitForFrame((frame) => frame.includes("inspect @test#1"))
  setup.mockInput.pressEnter()
  expect(await submitted.promise).toEqual({
    uri: pathToFileURL(second).href + "?start=1&end=1",
    content: "content B\n",
    metadata: false,
  })
  const original = (await Bun.file(path.join(state.path, "prompt-history.jsonl")).text()).split("\n")[0]
  expect(JSON.parse(original ?? "null")).toEqual(history)
})
