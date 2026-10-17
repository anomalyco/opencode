import { beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

// Earlier app tests in this process can leave a home draft that the prompt would restore.
beforeEach(() => takeDraft(undefined))

test("an agent mention after a tab replaces only the mention", async () => {
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  await using setup = await createAppFixture({
    fetch: (url) => {
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [
            { id: "build", mode: "primary", hidden: false, permissions: [] },
            { id: "助手", mode: "subagent", hidden: false, permissions: [] },
          ],
        })
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.pasteBracketedText("\f👨‍👩‍👧நி\t@助")
  await setup.waitForFrame((frame) => frame.includes("@助手"))
  setup.mockInput.pressEnter()
  const editor = setup.renderer.currentFocusedEditor!
  await setup.waitFor(() => editor.plainText === "\f👨‍👩‍👧நி\t@助手 ")
  const start = editor.editBuffer.measureText("\f👨‍👩‍👧நி\t")
  expect(editor.editorView.extmarks.getAll()).toMatchObject([
    { start, end: start + editor.editBuffer.measureText("@助手") },
  ])
})

test("history navigation moves the cursor to the end of wide text", async () => {
  await using state = await tmpdir()
  const file = path.join(state.path, "prompt-history.jsonl")
  const entry = (text: string) => JSON.stringify({ text, files: [], agents: [], skills: [], pasted: [] }) + "\n"
  await Bun.write(file, entry("中\t👨‍👩‍👧நி") + entry("末") + "corrupt\n")
  await using setup = await createAppFixture({ state: state.path })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  // The history provider rewrites the file without the corrupt line after it loads the entries.
  await setup.waitFor(async () => !(await Bun.file(file).text()).includes("corrupt"), { maxPasses: 200 })
  const text = () => setup.renderer.currentFocusedEditor?.plainText
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("末")
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("中\t👨‍👩‍👧நி")
  setup.mockInput.pressKey("END")
  setup.mockInput.pressArrow("down")
  await setup.mockInput.typeText("x")
  expect(text()).toBe("末x")
})
