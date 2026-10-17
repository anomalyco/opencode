import { beforeEach, expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json, worktree } from "./fixture/tui-client"

type Fixture = Awaited<ReturnType<typeof createAppFixture>>

const location = { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } }

beforeEach(() => {
  takeDraft(undefined)
})

test("current() follows typing, the caret, a selection, and the mode in UTF-16 units", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup

  setup.mockInput.pressKey("!")
  await setup.waitForFrame((frame) => frame.includes(draft("", 0, 0, "shell")))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => frame.includes(draft("", 0)))

  await setup.mockInput.typeText("日本")
  await setup.waitForFrame((frame) => frame.includes(draft("日本", 2)))
  await setup.mockInput.typeText(" abc")
  await setup.waitForFrame((frame) => frame.includes(draft("日本 abc", 6)))
  setup.mockInput.pressArrow("left", { shift: true })
  setup.mockInput.pressArrow("left", { shift: true })
  setup.mockInput.pressArrow("left", { shift: true })
  await setup.waitForFrame((frame) => frame.includes(draft("日本 abc", 3, 6)))
})

test("current() follows a mouse selection in the composer", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.mockInput.typeText("hello world")
  await setup.waitForFrame((frame) => frame.includes(draft("hello world", 11)))

  const rows = setup.captureCharFrame().split("\n")
  const row = rows.findIndex((line) => line.includes("hello world") && !line.includes("draft"))
  const column = rows[row]!.indexOf("hello world")
  await setup.mockMouse.drag(column, row, column + 4, row)
  await setup.waitForFrame((frame) => frame.includes(draft("hello world", 0, 5)))
})

test("append adds text at the end, moves the caret after it, and undoes in one step", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup

  setup.mockInput.pressKey("F3")
  await setup.waitForFrame((frame) => frame.includes("append true") && frame.includes(draft("[x]", 3)))
  await setup.mockInput.typeText("a")
  await setup.waitForFrame((frame) => frame.includes(draft("[x]a", 4)))

  setup.mockInput.pressKey("a", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes(draft("[x]a", 0)))
  setup.mockInput.pressKey("F3")
  await setup.waitForFrame((frame) => frame.includes(draft("[x]a[x]", 7)))
  await setup.mockInput.typeText("b")
  await setup.waitForFrame((frame) => frame.includes(draft("[x]a[x]b", 8)))

  setup.mockInput.pressKey("a", { ctrl: true })
  setup.mockInput.pressArrow("right", { shift: true })
  setup.mockInput.pressArrow("right", { shift: true })
  await setup.waitForFrame((frame) => frame.includes(draft("[x]a[x]b", 0, 3)))
  setup.mockInput.pressKey("F3")
  await setup.waitForFrame((frame) => frame.includes(draft("[x]a[x]b[x]", 11)))

  setup.mockInput.pressKey("-", { ctrl: true })
  await setup.waitFor(() => composer(setup) === "[x]a[x]b")
})

test("append leaves empty text alone and rejects values that are not strings", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.mockInput.typeText("abc")
  setup.mockInput.pressArrow("left")
  await setup.waitForFrame((frame) => frame.includes(draft("abc", 2)))

  setup.mockInput.pressKey("F4")
  await setup.waitForFrame((frame) => frame.includes("empty true"))
  expect(setup.captureCharFrame()).toContain(draft("abc", 2))

  setup.mockInput.pressKey("F1")
  await setup.waitForFrame((frame) => frame.includes("untyped threw TypeError"))
  expect(composer(setup)).toBe("abc")
})

test("a multiline append uses newlines and grows the composer", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.mockInput.typeText("first")
  await setup.waitFor(() => composer(setup) === "first")
  expect(setup.renderer.currentFocusedEditor?.height).toBe(1)

  setup.mockInput.pressKey("F12")
  await setup.waitForFrame((frame) => frame.includes("lines true"))
  expect(composer(setup)).toBe("first\nsecond\nthird")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor?.height === 3)
  const rows = setup.captureCharFrame().split("\n")
  const top = rows.findIndex((row) => row.includes("┃  first"))
  expect(rows.slice(top, top + 3).map((row) => row.trim())).toEqual(["┃  first", "┃  second", "┃  third"])
})

test("append keeps pasted and agent attachments through submit", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))

  await setup.mockInput.pasteBracketedText("line one\nline two\nline three")
  await setup.waitFor(() => composer(setup) === "[Pasted ~3 lines] ")
  await setup.mockInput.typeText("ask @rev")
  await setup.waitForFrame((frame) => frame.includes("@reviewer"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => composer(setup) === "[Pasted ~3 lines] ask @reviewer ")

  setup.mockInput.pressKey("F3")
  await setup.waitFor(() => composer(setup) === "[Pasted ~3 lines] ask @reviewer [x]")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => run.prompts.length === 1)
  expect(run.prompts[0]).toMatchObject({
    text: "line one\nline two\nline three ask @reviewer [x]",
    agents: [{ name: "reviewer", mention: { text: "@reviewer" } }],
  })
})

test("an append followed by navigation in the same command is stashed with the draft", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.mockInput.typeText("draft")
  await setup.waitFor(() => composer(setup) === "draft")
  const before = setup.renderer.currentFocusedEditor

  setup.mockInput.pressKey("F5")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor !== before && composer(setup) === "draft kept")
  await setup.waitForFrame((frame) => frame.includes(draft("draft kept", 10)))
})

test("without a mounted composer current() is undefined and append returns false", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.mockInput.typeText("home")
  await setup.waitForFrame((frame) => frame.includes(draft("home", 4)))

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame(
    (frame) => frame.includes("Away route") && frame.includes("away false") && frame.includes("draft null"),
  )
  setup.mockInput.pressKey("F3")
  await setup.waitForFrame((frame) => frame.includes("append false"))

  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes(draft("home", 4)))
})

test("a disabled composer still accepts appends", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin, { forms: true })
  const setup = run.setup
  await setup.waitForFrame((frame) => frame.includes("Input requested") && frame.includes(draft("", 0)))

  setup.mockInput.pressKey("F3")
  await setup.waitForFrame((frame) => frame.includes("append true") && frame.includes(draft("[x]", 3)))
})

test("a context from an ended activation can no longer append", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.mockInput.typeText("keep")
  setup.mockInput.pressKey("F11")
  await setup.waitForFrame((frame) => frame.includes("first true"))
  expect(composer(setup)).toBe("keep[x]")

  await Bun.write(plugin.entry, (await Bun.file(plugin.entry).text()).replace("generation 1", "generation 2"))
  await setup.waitForFrame((frame) => frame.includes("Prompt fixture ready generation 2"))
  setup.mockInput.pressKey("F11")
  await setup.waitForFrame((frame) => frame.includes("first false"))
  expect(composer(setup)).toBe("keep[x]")

  setup.mockInput.pressKey("F3")
  await setup.waitFor(() => composer(setup) === "keep[x][x]")
})

test("plugin commands clear and submit the composer through keymap dispatch", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))

  await setup.mockInput.typeText("clear me")
  await setup.waitFor(() => composer(setup) === "clear me")
  setup.mockInput.pressKey("F8")
  await setup.waitFor(() => composer(setup) === "")

  await setup.mockInput.typeText("send me")
  await setup.waitFor(() => composer(setup) === "send me")
  setup.mockInput.pressKey("F9")
  await setup.waitFor(() => run.prompts.length === 1)
  expect(run.prompts[0]).toMatchObject({ text: "send me" })
})

test("append closes completion so the same command can submit", async () => {
  await using plugin = await copyPlugin()
  await using run = await launch(plugin)
  const setup = run.setup
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))

  await setup.mockInput.typeText("ask @rev")
  await setup.waitForFrame((frame) => frame.includes("@reviewer"))
  setup.mockInput.pressKey("F10")
  await setup.waitFor(() => run.prompts.length === 1)
  expect(run.prompts[0]).toMatchObject({ text: "ask @rev now", agents: [] })
})

async function launch(plugin: { directory: string }, input: { forms?: boolean } = {}) {
  const prompts: unknown[] = []
  const sessions = new Map<string, object>()
  const setup = await createAppFixture({
    config: { animations: false, plugins: [plugin.directory] },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [
            { id: "build", mode: "primary", hidden: false, permissions: [] },
            { id: "reviewer", mode: "subagent", hidden: false, permissions: [] },
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
      if (url.pathname === "/api/form" && input.forms)
        return json({
          location,
          data: [
            {
              id: "frm_global",
              sessionID: "global",
              title: "Input requested",
              fields: [{ key: "authorization", type: "external", url: "https://example.com" }],
            },
          ],
        })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const record: { id: string } = await request.json()
        const session = {
          ...record,
          location: { directory },
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        }
        sessions.set(record.id, session)
        return json({ data: session })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        prompts.push(await request.json())
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(agent|model)$/.test(url.pathname)) return new Response(null, { status: 204 })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) {
        const session = sessions.get(url.pathname.split("/")[3] ?? "")
        if (!session) return json({ message: "not found" }, { status: 404 })
        return json({ data: session })
      }
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes(draft("", 0)))
  return { setup, prompts, [Symbol.asyncDispose]: setup[Symbol.asyncDispose] }
}

function draft(text: string, start: number, end = start, mode = "normal") {
  return `draft ${JSON.stringify({ text, selection: { start, end }, mode })}`
}

function composer(setup: Fixture) {
  return setup.renderer.currentFocusedEditor?.plainText
}

async function copyPlugin() {
  const root = await tmpdir()
  const directory = path.join(root.path, "prompt-api")
  const entry = path.join(directory, "tui.tsx")
  await mkdir(directory)
  await symlink(path.join(import.meta.dir, "../node_modules"), path.join(directory, "node_modules"))
  await Bun.write(entry, Bun.file(path.join(import.meta.dir, "fixture/plugin/prompt-api/tui.tsx")))
  return { directory, entry, [Symbol.asyncDispose]: root[Symbol.asyncDispose] }
}
