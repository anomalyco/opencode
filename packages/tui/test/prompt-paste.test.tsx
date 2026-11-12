import { TextareaRenderable } from "@opentui/core"
import { beforeEach, expect, test } from "bun:test"
import "../src/app"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

// Other app tests can leave a home draft in the process-wide stash.
beforeEach(() => takeDraft(undefined))

test("the prompt keeps pasted control characters and drops escape sequences", async () => {
  await using setup = await createAppFixture()
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.typeText("x")
  await setup.waitForFrame((frame) => frame.includes("x"))
  await setup.mockInput.pasteBracketedText("a\fb\u001b[31mc\u0000d")
  await setup.waitForFrame((frame) => frame.includes("xa^Lbc^@d"))
  expect(setup.renderer.currentFocusedEditor?.plainText).toBe("xa\fbc\0d")
})

test("undoing a deleted or expanded paste chip restores its payload without reviving partial fragments", async () => {
  const sessionID = `ses_paste_${crypto.randomUUID()}`
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const sent: string[] = []
  await using setup = await createAppFixture({
    args: { sessionID },
    fetch: async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "proj_test",
            title: "Paste fixture",
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
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        const body = await request.json()
        sent.push(body.text)
        return json({
          data: { id: body.id, sessionID, type: "user", time: { created: 100 }, payload: { text: body.text } },
        })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  const editor = setup.renderer.currentFocusedEditor
  if (!(editor instanceof TextareaRenderable)) throw new Error("expected the focused prompt textarea")
  const text = () => editor.plainText

  const pasted = "line 1\nline 2\nline 3\nline 4"
  const label = "[Pasted ~4 lines]"

  // Delete collapsed paste -> undo -> submit sends the pasted text.
  await setup.mockInput.pasteBracketedText(pasted)
  await setup.waitFor(() => text() === `${label} `)
  setup.mockInput.pressBackspace()
  setup.mockInput.pressBackspace()
  await setup.waitFor(() => text() === "")
  setup.mockInput.pressKey("z", { super: true })
  await setup.waitFor(() => text() === label)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => sent.length === 1)
  expect(sent[0]).toBe(pasted)

  // Chunked word-delete of the label -> one undo -> submit sends the fragment, not the paste.
  await setup.mockInput.pasteBracketedText(pasted)
  await setup.waitFor(() => text() === `${label} `)
  while (text() !== "") {
    const prev = text()
    setup.mockInput.pressKey("w", { ctrl: true })
    await setup.waitFor(() => text() !== prev)
  }
  setup.mockInput.pressKey("z", { super: true })
  await setup.waitFor(() => text() === "[")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => sent.length === 2)
  expect(sent[1]).toBe("[")

  // Expand chip -> undo -> submit sends the pasted text.
  await setup.mockInput.pasteBracketedText(pasted)
  const frame = await setup.waitForFrame((frame) => frame.includes(label))
  const lines = frame.split("\n")
  const row = lines.findIndex((line) => line.includes(label))
  await setup.mockMouse.click(lines[row]!.indexOf(label) + 2, row)
  await setup.waitFor(() => text() === `${pasted} `)
  expect(editor.extmarks.getAll()).toEqual([])
  while (text() !== `${label} `) {
    const prev = text()
    setup.mockInput.pressKey("z", { super: true })
    await setup.waitFor(() => text() !== prev)
  }
  setup.mockInput.pressEnter()
  await setup.waitFor(() => sent.length === 3)
  expect(sent[2]).toBe(`${pasted} `)
})
