import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { takeDraft } from "../src/component/prompt/draft-stash"
import type { Config } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

// Earlier app tests in this process can leave a home draft that the prompt would restore.
beforeEach(() => takeDraft(undefined))

const originalPortEnv = {
  editor: process.env.OPENCODE_EDITOR_SSE_PORT,
  claude: process.env.CLAUDE_CODE_SSE_PORT,
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

afterEach(() => {
  restoreEnv("OPENCODE_EDITOR_SSE_PORT", originalPortEnv.editor)
  restoreEnv("CLAUDE_CODE_SSE_PORT", originalPortEnv.claude)
})

// An editor-side WebSocket server speaking the Claude Code protocol that the
// upstream EditorContext connects to (`initialize`, `selection_changed`,
// `at_mentioned`).
function startEditor() {
  const sockets = new Set<Bun.ServerWebSocket<undefined>>()
  const connected = Promise.withResolvers<void>()
  const server = Bun.serve<undefined>({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return undefined
      return new Response("editor")
    },
    websocket: {
      open(socket) {
        sockets.add(socket)
        connected.resolve()
      },
      close(socket) {
        sockets.delete(socket)
      },
      message(socket, raw) {
        const message = JSON.parse(String(raw))
        if (message.method !== "initialize") return
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }))
      },
    },
  })
  const notify = (method: string, params: unknown) => {
    for (const socket of sockets) socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }))
  }
  return {
    port: server.port,
    connected: connected.promise,
    // The protocol sends 0-based positions; the helper takes 1-based lines so
    // assertions read the numbers users see.
    selection(file: string, start: number, end = start) {
      notify("selection_changed", {
        text: "selected text",
        filePath: path.join(directory, file),
        selection: { start: { line: start - 1, character: 0 }, end: { line: end - 1, character: 5 } },
      })
    },
    mention(file: string, lineStart: number, lineEnd = lineStart) {
      notify("at_mentioned", { filePath: path.join(directory, file), lineStart, lineEnd })
    },
    stop: () => server.stop(true),
  }
}

async function open(config?: Config.Info) {
  const editor = startEditor()
  process.env.OPENCODE_EDITOR_SSE_PORT = String(editor.port)
  delete process.env.CLAUDE_CODE_SSE_PORT
  const setup = await createAppFixture({
    config: { animations: false, experimental: { "live-follow": true }, ...config },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await editor.connected
  const prompt = () => setup.renderer.currentFocusedEditor!
  return {
    setup,
    editor,
    prompt,
    async close() {
      await setup[Symbol.asyncDispose]()
      await editor.stop()
    },
  }
}

test("live IDE follow stays off without the experiment", async () => {
  const app = await open({ experimental: { "live-follow": false } })
  try {
    app.editor.selection("AAA.ts", 1, 2)
    // The editor-context label proves the selection arrived; the chip must not appear.
    await app.setup.waitForFrame((frame) => frame.includes("AAA.ts"))
    expect(app.prompt().plainText).toBe("")
    expect(app.prompt().editorView.extmarks.getAll()).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test("live IDE follow chip replaces the trailing chip in the prompt", async () => {
  const app = await open()
  try {
    app.editor.selection("AAA.ts", 1, 2)
    await app.setup.waitFor(() => app.prompt().plainText === "@AAA.ts#1-2 ")

    // The chip is a real file extmark spanning the whole mention.
    const first = app.prompt().editorView.extmarks.getAll()
    expect(first).toHaveLength(1)
    expect(app.prompt().plainText.slice(first[0].start, first[0].end)).toBe("@AAA.ts#1-2")

    // A new selection replaces the chip rather than appending another one.
    app.editor.selection("BBB.ts", 3, 4)
    await app.setup.waitFor(() => app.prompt().plainText === "@BBB.ts#3-4 ")
    const marks = app.prompt().editorView.extmarks.getAll()
    expect(marks).toHaveLength(1)
    expect(app.prompt().plainText.slice(marks[0].start, marks[0].end)).toBe("@BBB.ts#3-4")
  } finally {
    await app.close()
  }
})

test("live IDE follow chip keeps the typing cursor in place", async () => {
  const app = await open()
  try {
    await app.setup.mockInput.typeText("explain ")
    app.editor.selection("AAA.ts", 1, 2)
    await app.setup.waitFor(() => app.prompt().plainText === "explain @AAA.ts#1-2 ")

    // Keep typing after the chip, then let the IDE selection move elsewhere.
    await app.setup.mockInput.typeText("and more")
    await app.setup.waitFor(() => app.prompt().plainText === "explain @AAA.ts#1-2 and more")

    app.editor.selection("BBB.ts", 3, 4)
    await app.setup.waitFor(() => app.prompt().plainText === "explain @BBB.ts#3-4 and more")

    // The cursor stays at the end; the next keystroke appends instead of
    // landing right after the replaced chip.
    await app.setup.mockInput.typeText("X")
    await app.setup.waitFor(() => app.prompt().plainText === "explain @BBB.ts#3-4 and moreX")
  } finally {
    await app.close()
  }
})

test("live IDE follow clear removes the chip through the editor-context command", async () => {
  // The production command is unbound by default, so bind it and press the key.
  const app = await open({ keybinds: { "prompt.editor_context.clear": "f12" } })
  try {
    app.editor.selection("AAA.ts", 1, 2)
    await app.setup.waitFor(() => app.prompt().plainText === "@AAA.ts#1-2 ")

    app.setup.mockInput.pressKey("F12")
    await app.setup.waitFor(() => app.prompt().plainText === "")
    expect(app.prompt().editorView.extmarks.getAll()).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test("live IDE follow keeps an at-mentioned file while the chip keeps following", async () => {
  const app = await open()
  try {
    app.editor.selection("AAA.ts", 1, 2)
    await app.setup.waitFor(() => app.prompt().plainText === "@AAA.ts#1-2 ")

    // The editor's native @-mention commits a permanent file mention.
    app.editor.mention("Pinned.ts", 7)
    await app.setup.waitFor(() => app.prompt().plainText.includes("@Pinned.ts#7"))
    expect(app.prompt().plainText).toBe("@AAA.ts#1-2 @Pinned.ts#7 ")

    // Following replaces only the chip and leaves the committed mention intact.
    app.editor.selection("BBB.ts", 3, 4)
    await app.setup.waitFor(() => app.prompt().plainText.includes("@BBB.ts#3-4"))
    expect(app.prompt().plainText).toBe("@BBB.ts#3-4 @Pinned.ts#7 ")
    expect(app.prompt().editorView.extmarks.getAll()).toHaveLength(2)
  } finally {
    await app.close()
  }
})

test("live IDE follow appends a fresh chip after the chip text is deleted", async () => {
  const app = await open()
  try {
    app.editor.selection("AAA.ts", 1, 2)
    await app.setup.waitFor(() => app.prompt().plainText === "@AAA.ts#1-2 ")

    Array.from({ length: 12 }, () => app.setup.mockInput.pressBackspace())
    await app.setup.waitFor(() => app.prompt().plainText === "")
    expect(app.prompt().editorView.extmarks.getAll()).toHaveLength(0)

    await app.setup.mockInput.typeText("fix ")
    await app.setup.waitFor(() => app.prompt().plainText === "fix ")
    app.setup.mockInput.pressArrow("left")

    app.editor.selection("CCC.ts", 5)
    await app.setup.waitFor(() => app.prompt().plainText === "fix @CCC.ts#5 ")
    const marks = app.prompt().editorView.extmarks.getAll()
    expect(marks).toHaveLength(1)
    expect(app.prompt().plainText.slice(marks[0].start, marks[0].end)).toBe("@CCC.ts#5")
  } finally {
    await app.close()
  }
})

test("submitting with the chip sends one file attachment and no synthetic editor context", async () => {
  const editor = startEditor()
  const sessionID = `ses_live_follow_${crypto.randomUUID()}`
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const prompts: any[] = []
  const synthetics: any[] = []
  process.env.OPENCODE_EDITOR_SSE_PORT = String(editor.port)
  delete process.env.CLAUDE_CODE_SSE_PORT
  const setup = await createAppFixture({
    config: { animations: false, experimental: { "live-follow": true } },
    args: { sessionID },
    fetch: async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            title: "Live follow fixture",
            projectID: "proj_test",
            location: { directory },
            agent: "build",
            model: { providerID: "demo", id: "model" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
        return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        prompts.push(await request.json())
        return json({ data: {} })
      }
      if (url.pathname === `/api/session/${sessionID}/synthetic`) {
        synthetics.push(await request.json())
        return json({ data: {} })
      }
      return undefined
    },
  })
  try {
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Demo Model"))
    await editor.connected
    const prompt = () => setup.renderer.currentFocusedEditor!

    editor.selection("AAA.ts", 2, 3)
    await setup.waitFor(() => prompt().plainText === "@AAA.ts#2-3 ")
    await setup.mockInput.typeText("explain")
    setup.mockInput.pressEnter()

    await setup.waitFor(() => prompts.length === 1)
    // The chip rides along as the only form of editor context: a real file
    // attachment with 1-based ?start&end, and no synthetic system reminder.
    expect(synthetics).toHaveLength(0)
    expect(prompts[0].files).toHaveLength(1)
    const uri = new URL(prompts[0].files[0].uri)
    expect(`${uri.pathname}${uri.search}`).toBe(path.join(directory, "AAA.ts") + "?start=2&end=3")
    expect(prompts[0].text).toBe("@AAA.ts#2-3 explain")

    // The composer is cleared and the chip does not come back until the next
    // real selection change.
    await setup.waitFor(() => prompt().plainText === "")
    editor.selection("BBB.ts", 4)
    await setup.waitFor(() => prompt().plainText === "@BBB.ts#4 ")
  } finally {
    await setup[Symbol.asyncDispose]()
    await editor.stop()
  }
})
