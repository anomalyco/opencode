import { beforeEach, expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

// Earlier app tests in this process can leave a home draft that the prompt would restore.
beforeEach(() => takeDraft(undefined))

const location = { directory, project: { id: "proj_test", directory, canonical: directory } }

function fixture() {
  return createAppFixture({
    fetch: (url) => {
      if (url.pathname === "/api/command")
        return json({
          location,
          data: [
            { name: "review", description: "Review the input" },
            { name: "deploy", description: "Ship the thing to review" },
          ],
        })
    },
  })
}

// The command list loads asynchronously; an empty list would close a mid-prompt popup immediately.
async function loaded(setup: Awaited<ReturnType<typeof fixture>>) {
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.typeText("/")
  await setup.waitForFrame((frame) => frame.includes("Ship the thing"))
  setup.mockInput.pressBackspace()
  await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === "")
}

test("completes a command mid-prompt and keeps the surrounding text", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("explain /rev")
  await setup.waitForFrame((frame) => frame.includes("Review the input"))
  setup.mockInput.pressEnter()
  const editor = setup.renderer.currentFocusedEditor!
  await setup.waitFor(() => editor.plainText === "explain /review ")
  expect(editor.cursorOffset).toBe("explain /review ".length)
})

test("completes a command before text that follows the cursor without a double space", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("explain  now")
  const editor = setup.renderer.currentFocusedEditor!
  editor.cursorOffset = "explain ".length
  await setup.mockInput.typeText("/rev")
  await setup.waitForFrame((frame) => frame.includes("Review the input"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => editor.plainText === "explain /review now")
  expect(editor.cursorOffset).toBe("explain /review".length)
})

test("matches command names by prefix mid-prompt", async () => {
  await using setup = await fixture()
  await loaded(setup)
  // "deploy" only matches "rev" through its description.
  await setup.mockInput.typeText("explain /rev")
  await setup.waitForFrame((frame) => frame.includes("Review the input"))
  expect(setup.captureCharFrame()).not.toContain("/deploy")
})

test("does not offer commands that would run mid-prompt", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("explain /ne")
  const editor = setup.renderer.currentFocusedEditor!
  await setup.waitFor(() => editor.plainText === "explain /ne")
  expect(setup.captureCharFrame()).not.toContain("Start a new session")
  expect(setup.captureCharFrame()).not.toContain("No matching commands")
})

test("a bare slash or an unmatched token does not open the popup", async () => {
  await using setup = await fixture()
  await loaded(setup)
  await setup.mockInput.typeText("find /")
  const editor = setup.renderer.currentFocusedEditor!
  await setup.waitFor(() => editor.plainText === "find /")
  expect(setup.captureCharFrame()).not.toContain("Review the input")
  await setup.mockInput.typeText("zzz")
  await setup.waitFor(() => editor.plainText === "find /zzz")
  expect(setup.captureCharFrame()).not.toContain("No matching commands")
})
