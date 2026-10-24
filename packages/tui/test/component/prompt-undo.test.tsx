import { expect, setDefaultTimeout, test } from "bun:test"
import { wait, withPrompt } from "../fixture/prompt-app"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(30_000)

// Upstream's default undo and redo keys, as a kitty-protocol terminal sends them.
const UNDO = "\x1b[45;5u"
const REDO = "\x1b[46;5u"
const CTRL_U = "\x15"
const CTRL_W = "\x17"

test("undo brings back a line deleted with ctrl+u, then the typing before it word by word", async () => {
  await withPrompt(async (rig) => {
    for (const char of "hello brave world") await rig.press(char)
    await rig.press(CTRL_U)
    expect(rig.text()).toBe("")
    await rig.press(UNDO)
    expect(rig.text()).toBe("hello brave world")
    await rig.press(UNDO)
    expect(rig.text()).toBe("hello brave ")
    await rig.press(REDO)
    expect(rig.text()).toBe("hello brave world")
  })
})

test("undo after deleting a paste placeholder restores it with its pasted text", async () => {
  await withPrompt(async (rig) => {
    for (const char of "see ") await rig.press(char)
    await rig.press("\x1b[200~one\ntwo\nthree\x1b[201~")
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(rig.parts()).toBe(1)
    await rig.press("\x7f") // backspace the space after it
    await rig.press(CTRL_W)
    expect(rig.text()).toBe("see ")
    expect(rig.parts()).toBe(0)
    await rig.press(UNDO)
    expect(rig.text()).toBe("see [Pasted ~3 lines]")
    expect(rig.parts()).toBe(1)
    await rig.press("\r")
    await wait(() => rig.sent.length > 0)
    expect(rig.sent[0]).toContain(JSON.stringify("see one\ntwo\nthree"))
  })
})

test("undo after a submit brings back what was sent without aborting the running turn", async () => {
  await withPrompt(async (rig) => {
    for (const char of "second prompt") await rig.press(char)
    await rig.press("\r")
    await wait(() => rig.text() === "")
    await rig.press(UNDO)
    expect(rig.text()).toBe("second prompt")
    expect(rig.paths.some((path) => path.endsWith("/abort"))).toBe(false)
    await rig.press(REDO)
    expect(rig.text()).toBe("")
  })
})
