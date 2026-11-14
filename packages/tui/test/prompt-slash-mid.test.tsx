import { beforeEach, expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

// Earlier app tests in this process can leave a home draft that the prompt would restore.
beforeEach(() => takeDraft(undefined))

const location = { directory, project: { id: "proj_test", directory, canonical: directory } }

const skill = (id: string, description: string) => ({
  id,
  name: id,
  description,
  path: `/skills/${id}/SKILL.md`,
  content: "",
})

function fixture() {
  return createAppFixture({
    fetch: (url) => {
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", description: "Review the input" }] })
      if (url.pathname === "/api/skill")
        return json({
          location,
          data: [
            skill("arch-design", "Write a design doc"),
            skill("arch-review", "Review a design doc"),
            skill("code-gen", "Generate code"),
          ],
        })
    },
  })
}

// Waits for the typed text to reach the screen, then lets the popup state settle so a negative check is not vacuous.
async function settled(setup: Awaited<ReturnType<typeof fixture>>, text: string) {
  await setup.waitForFrame((frame) => frame.includes(text))
  await setup.renderOnce()
  await setup.renderOnce()
  return setup.captureCharFrame()
}

// The skill list loads asynchronously; an empty list would close a mid-prompt popup immediately.
async function loaded(setup: Awaited<ReturnType<typeof fixture>>) {
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  // Probe the skill list through the "@" popup, which only shows entries once the request resolved.
  await setup.mockInput.typeText("@code")
  await setup.waitForFrame((frame) => frame.includes("Generate code"))
  for (let i = 0; i < 5; i++) setup.mockInput.pressBackspace()
  await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === "")
}

test("a slash mid-prompt mentions a skill and keeps the surrounding text", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("explain this with /code")
  await setup.waitForFrame((frame) => frame.includes("@code-gen") && frame.includes("Generate code"))
  setup.mockInput.pressEnter()
  const editor = setup.renderer.currentFocusedEditor!
  await setup.waitFor(() => editor.plainText === "explain this with @code-gen ")
  const start = editor.editBuffer.measureText("explain this with ")
  expect(editor.editorView.extmarks.getAll()).toMatchObject([
    { start, end: start + editor.editBuffer.measureText("@code-gen") },
  ])
})

test("several skills can be mentioned in one prompt", async () => {
  await using setup = await fixture()
  await loaded(setup)
  const editor = setup.renderer.currentFocusedEditor!
  await setup.mockInput.typeText("write it with /code")
  await setup.waitForFrame((frame) => frame.includes("Generate code"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => editor.plainText === "write it with @code-gen ")
  await setup.mockInput.typeText("then check it with /arch-r")
  await setup.waitForFrame((frame) => frame.includes("Review a design doc"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => editor.plainText === "write it with @code-gen then check it with @arch-review ")
  expect(editor.editorView.extmarks.getAll()).toHaveLength(2)
})

test("a skill that is already mentioned is not offered again", async () => {
  await using setup = await fixture()
  await loaded(setup)
  const editor = setup.renderer.currentFocusedEditor!
  await setup.mockInput.typeText("use /code")
  await setup.waitForFrame((frame) => frame.includes("Generate code"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => editor.plainText === "use @code-gen ")
  await setup.mockInput.typeText("and /code")
  expect(await settled(setup, "use @code-gen and /code")).not.toContain("Generate code")
})

test("matches skill names by prefix", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("explain /arch")
  await setup.waitForFrame((frame) => frame.includes("Write a design doc"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain("@arch-review")
  expect(frame).not.toContain("@code-gen")
})

test("commands are not offered mid-prompt", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("explain /rev")
  const frame = await settled(setup, "explain /rev")
  expect(frame).not.toContain("Review the input")
  expect(frame).not.toContain("No matching commands")
})

test("a bare slash or an unmatched token does not open the popup", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("find /")
  expect(await settled(setup, "find /")).not.toContain("Generate code")
  await setup.mockInput.typeText("zzz")
  expect(await settled(setup, "find /zzz")).not.toContain("No matching")
})

test("commands still open at the start of the prompt when no skills exist", async () => {
  await using setup = await createAppFixture({
    fetch: (url) => {
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", description: "Review the input" }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.typeText("/rev")
  await setup.waitForFrame((frame) => frame.includes("Review the input"))
})
