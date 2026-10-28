import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { json } from "./fixture/tui-client"

test.each(["typed", "editor"])("preserves a %s single-line mention through submission and history", async (source) => {
  await using state = await tmpdir()
  const directory = process.cwd()
  const connected = Promise.withResolvers<() => void>()
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response(null, { status: 404 })),
    websocket: {
      open(socket) {
        connected.resolve(() =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "at_mentioned",
              params: { filePath: path.join(directory, "big.txt"), lineStart: 10, lineEnd: 10 },
            }),
          ),
        )
      },
      message() {},
    },
  })
  const env = {
    CLAUDE_CODE_SSE_PORT: process.env.CLAUDE_CODE_SSE_PORT,
    OPENCODE_EDITOR_SSE_PORT: process.env.OPENCODE_EDITOR_SSE_PORT,
  }
  delete process.env.CLAUDE_CODE_SSE_PORT
  process.env.OPENCODE_EDITOR_SSE_PORT = String(server.port)
  try {
    const sessionID = `ses_file_range_${crypto.randomUUID()}`
    const location = { directory, project: { id: "project", directory, canonical: directory } }
    const bodies: unknown[] = []
    const submitted = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const lookup = Promise.withResolvers<void>()
    await using setup = await createAppFixture({
      width: 100,
      height: 30,
      state: state.path,
      args: { sessionID },
      fetch: async (url, request) => {
        if (url.pathname === "/api/location") return json(location)
        if (url.pathname === `/api/session/${sessionID}`)
          return json({
            data: {
              id: sessionID,
              projectID: "project",
              title: "File range fixture",
              agent: "build",
              model: { providerID: "demo", id: "model" },
              location: { directory },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 0, updated: 0 },
            },
          })
        if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
        if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
        if (url.pathname === "/api/agent")
          return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
        if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
        if (url.pathname === "/api/model")
          return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
        if (url.pathname === "/api/fs/find") {
          if (source === "typed") await lookup.promise
          return json({ location, data: [{ path: "big.txt", type: "file" }] })
        }
        if (url.pathname === `/api/session/${sessionID}/prompt`) {
          bodies.push(await request.json())
          submitted[bodies.length - 1]?.resolve()
          return json({ data: {} })
        }
      },
    })
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Demo Model"))
    await setup.waitFor(() => setup.renderer.currentFocusedEditor !== null)
    if (source === "editor") (await connected.promise)()
    else {
      try {
        await setup.mockInput.typeText("@big.txt#10-10")
        await setup.waitForFrame((frame) => frame.includes("@big.txt#10-10"))
      } finally {
        lookup.resolve()
      }
      // The prompt alone is not enough: wait for the completed option too.
      await setup.waitForFrame((frame) => frame.split("big.txt#10-10").length === 3)
      setup.mockInput.pressKey("TAB")
    }
    const editor = setup.renderer.currentFocusedEditor!
    await setup.waitFor(() => editor.editorView.extmarks.getAll().length === 1)
    expect(editor.plainText).toBe("@big.txt#10-10 ")
    await setup.mockInput.typeText("inspect")
    setup.mockInput.pressEnter()
    await submitted[0]!.promise
    await setup.waitFor(() => editor.plainText === "")
    setup.mockInput.pressArrow("up")
    await setup.waitFor(() => editor.plainText === "@big.txt#10-10 inspect")
    await setup.mockInput.typeText(" again")
    setup.mockInput.pressEnter()
    await submitted[1]!.promise

    const uri = pathToFileURL(path.join(directory, "big.txt"))
    uri.searchParams.set("start", "10")
    uri.searchParams.set("end", "10")
    for (const body of bodies) expect(body).toMatchObject({ files: [{ uri: uri.href, name: "big.txt#10-10" }] })
    const history = Bun.file(path.join(state.path, "prompt-history.jsonl"))
    await setup.waitFor(async () => (await history.exists()) && (await history.text()).includes(uri.href))
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await server.stop(true)
  }
})
