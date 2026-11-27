import { expect, test } from "bun:test"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"

for (const command of ["prompt.stash.pop", "prompt.stash.list"] as const) {
  test(`${command} restores a stashed shell draft in shell mode`, async () => {
    takeDraft(undefined)
    await using setup = await createAppFixture({
      config: { animations: false, keybinds: { "prompt.stash": "f6", [command]: "f7" } },
    })
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("commands"))
    const editor = setup.renderer.currentFocusedEditor!

    await setup.mockInput.typeText("!echo draft")
    setup.mockInput.pressKey("F6")
    expect(editor.plainText).toBe("")
    setup.mockInput.pressEscape()
    await setup.waitForFrame((frame) => !frame.includes("Shell"))
    setup.mockInput.pressKey("F7")
    if (command === "prompt.stash.list") {
      await setup.waitForFrame((frame) => frame.includes("Stash") && frame.includes("echo draft"))
      setup.mockInput.pressKey("RETURN")
    }

    expect(editor.plainText).toBe("echo draft")
    await setup.waitForFrame((frame) => frame.includes("Shell"))
  })
}
