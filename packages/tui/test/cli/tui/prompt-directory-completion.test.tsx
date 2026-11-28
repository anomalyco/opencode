import { expect, test } from "bun:test"
import { createAppFixture } from "../../fixture/app"
import { tmpdir } from "../../fixture/fixture"
import { directory, json } from "../../fixture/tui-client"

test("completes a /cd directory argument with the picker's separator", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url) => {
      if (url.pathname === "/api/fs/list")
        return json({
          location: { directory, project: { id: "proj_test", directory, canonical: directory } },
          data: [{ path: "packages", type: "directory" }],
        })
      return undefined
    },
  })
  await setup.ready
  await setup.waitFor(() => setup.captureCharFrame().includes("commands"))
  const editor = setup.renderer.currentFocusedEditor!

  await setup.mockInput.typeText("/cd pac")
  await setup.waitFor(() => setup.captureCharFrame().includes("packages/"))
  // The autocomplete keymap layer is pushed in an effect, so render the popup frame before Tab.
  await setup.renderOnce()

  setup.mockInput.pressTab()
  await setup.waitForVisualIdle()

  expect(editor.plainText).toBe("/cd packages/")
}, 60000)
