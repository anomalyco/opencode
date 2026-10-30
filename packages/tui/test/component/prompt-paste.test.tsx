import { expect, setDefaultTimeout, test } from "bun:test"
import { wait, withPrompt, type PromptRig } from "../fixture/prompt-app"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(30_000)

const UNDO = "\x1b[45;5u"
const ESCAPE = "\x1b"
const ENTER = "\r"
const SHIFT_ENTER = "\x1b[13;2u"
const CTRL_J = "\n"
const UP = "\x1b[A"
const DOWN = "\x1b[B"
const RIGHT = "\x1b[C"
const TAB = "\t"
const SHIFT_TAB = "\x1b[Z"

// Where the frame shows `label`, as the cell to click inside it.
function find(rig: PromptRig, label: string) {
  const lines = rig.frame().split("\n")
  const y = lines.findIndex((line) => line.includes(label))
  if (y === -1) throw new Error(`"${label}" is not on screen:\n${rig.frame()}`)
  return { x: lines[y].indexOf(label) + 2, y }
}

async function pasteBlock(rig: PromptRig) {
  for (const char of "see ") await rig.press(char)
  await rig.press("\x1b[200~one\ntwo\nthree\x1b[201~")
  expect(rig.text()).toBe("see [Pasted ~3 lines] ")
}

// A lone escape byte is held briefly in case more of a sequence follows.
async function close(rig: PromptRig) {
  await rig.press(ESCAPE)
  await wait(() => !rig.frame().includes("Pasted text"))
}

async function closed(rig: PromptRig) {
  await wait(() => !rig.frame().includes("Pasted text"))
}

async function openPlaceholder(rig: PromptRig) {
  const at = find(rig, "[Pasted ~3 lines]")
  await rig.click(at.x, at.y)
  find(rig, "Pasted text")
}

// What the prompt sends, which is the pasted text the placeholder stands for.
async function submitted(rig: PromptRig) {
  await rig.press("\r")
  await wait(() => rig.sent.length > 0)
  return JSON.parse(rig.sent[0]).parts.find((part: { type: string }) => part.type === "text").text
}

test("clicking a placeholder opens its text to edit, and escape keeps the edit", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    for (const char of "zero") await rig.press(char)
    await rig.press(SHIFT_ENTER) // the prompt's newline key adds a line
    await close(rig)
    expect(rig.text()).toBe("see [Pasted ~4 lines] ")
    expect(rig.sent).toEqual([])
    expect(await submitted(rig)).toBe("see zero\none\ntwo\nthree ")
  })
})

test("an edit that keeps the line count keeps the label and changes the text", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press("X")
    await close(rig)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(await submitted(rig)).toBe("see Xone\ntwo\nthree ")
  })
})

test("Insert inline replaces the placeholder with its text, and undo puts the placeholder back", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    const button = find(rig, "Insert inline")
    await rig.click(button.x, button.y)
    await closed(rig)
    expect(rig.text()).toBe("see one\ntwo\nthree ")
    expect(rig.parts()).toBe(0)
    await rig.press(UNDO)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(rig.parts()).toBe(1)
    expect(await submitted(rig)).toBe("see one\ntwo\nthree ")
  })
})

test("enter saves and closes like escape, and ctrl+j adds a line", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press("X")
    await rig.press(CTRL_J)
    await rig.press(ENTER)
    await closed(rig)
    expect(rig.text()).toBe("see [Pasted ~4 lines] ")
    expect(rig.sent).toEqual([])
    expect(await submitted(rig)).toBe("see X\none\ntwo\nthree ")
  })
})

test("tab moves from the text to Keep as block, which saves and keeps the placeholder", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press(DOWN) // the caret's row does not matter
    await rig.press("X")
    await rig.press(TAB)
    await rig.press("Z") // typed on a button: goes nowhere
    await rig.press(ENTER)
    await closed(rig)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(await submitted(rig)).toBe("see one\nXtwo\nthree ")
  })
})

test("tab twice reaches Insert inline, and enter on it inlines the text", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press(TAB)
    await rig.press(TAB)
    await wait(() => !rig.frame().includes("esc/enter save"))
    find(rig, "esc save")
    await rig.press(ENTER)
    await closed(rig)
    expect(rig.text()).toBe("see one\ntwo\nthree ")
    expect(rig.parts()).toBe(0)
  })
})

test("a third tab goes back to the text, and shift+tab goes the other way", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press(TAB)
    await rig.press(TAB)
    await rig.press(TAB)
    await rig.press("A") // back in the text
    await rig.press(SHIFT_TAB) // to Insert inline
    find(rig, "esc save")
    await rig.press(SHIFT_TAB) // to Keep as block
    await rig.press(SHIFT_TAB) // to the text
    await rig.press("B")
    await rig.press(ENTER)
    await closed(rig)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(await submitted(rig)).toBe("see ABone\ntwo\nthree ")
  })
})

test("up on the first row moves to the buttons, right then enter inlines", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press(UP)
    await rig.press(RIGHT)
    find(rig, "esc save")
    await rig.press(ENTER)
    await closed(rig)
    expect(rig.text()).toBe("see one\ntwo\nthree ")
    expect(rig.parts()).toBe(0)
  })
})

test("up below the first row moves the caret, and down from the buttons goes back to the text", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press(DOWN)
    await rig.press(UP) // back to the first row, still in the text
    await rig.press("A")
    await rig.press(UP) // now on the first row: to Keep as block
    await rig.press("Z") // typed on a button: goes nowhere
    await rig.press(DOWN)
    await rig.press("B")
    await rig.press(ENTER)
    await closed(rig)
    expect(await submitted(rig)).toBe("see ABone\ntwo\nthree ")
  })
})

test("clicking Keep as block saves the edit and keeps the placeholder", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press("X")
    const button = find(rig, "Keep as block")
    await rig.click(button.x, button.y)
    await closed(rig)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(await submitted(rig)).toBe("see Xone\ntwo\nthree ")
  })
})

// A paste of 6 lines, two of them longer than the editor is wide, is 8 rows once wrapped:
// the editor shows all of them without scrolling.
test("the editor is as tall as the paste once wrapped", async () => {
  await withPrompt(
    async (rig) => {
      const long = (tag: string) => `${tag} ${"word ".repeat(30)}${tag}-end`
      const text = ["one", long("A"), "three", long("B"), "five", "six"].join("\n")
      await rig.press(`\x1b[200~${text}\x1b[201~`)
      await rig.click(find(rig, "[Pasted ~6 lines]").x, find(rig, "[Pasted ~6 lines]").y)
      const frame = rig.frame()
      for (const visible of ["one", "A-end", "three", "B-end", "five", "six"]) expect(frame).toContain(visible)
      const rows = frame.split("\n")
      const first = rows.findIndex((row) => /┃\s+one\s*$/.test(row))
      const last = rows.findIndex((row) => /┃\s+six\s*$/.test(row))
      expect(last - first).toBe(7)
      // Below the last row of text: the box's padding row, its edge, then the hint row.
      expect(rows[last + 1]).toMatch(/┃\s*$/)
      expect(rows[last + 2]).toContain("╹▀")
      expect(rows[last + 3]).toContain("esc/enter save")
    },
    { height: 40 },
  )
})

// The editor sits in the prompt's box: the bar down its left, a padding row above and below the
// text and the half-row edge, without the prompt's agent line. The buttons are above it and the
// save hint is under its right end, where the prompt shows ctrl+p commands.
test("the editor is drawn in the prompt's box without the agent line", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    const prompt = rig.frame().split("\n")
    const promptText = prompt.findIndex((row) => row.includes("see [Pasted"))
    const promptColumn = prompt[promptText].indexOf("see")
    await openPlaceholder(rig)
    const rows = rig.frame().split("\n")
    const action = rows.findIndex((row) => row.includes("Keep as block"))
    expect(rows[action]).toContain("Insert inline")
    const one = rows.findIndex((row) => /┃\s+one\s*$/.test(row))
    expect(one).toBe(action + 3)
    expect(rows[action + 1].trim()).toBe("")
    expect(rows[action + 2]).toMatch(/┃\s*$/)
    for (const row of [rows[one], rows[one + 1], rows[one + 2]]) {
      // The same gap from the bar to the text as in the prompt.
      expect(row.indexOf("┃") + promptColumn - prompt[promptText].indexOf("┃")).toBe(row.search(/[a-z]/))
    }
    expect(rows[one + 3]).toMatch(/┃\s*$/)
    expect(rows[one + 4]).toContain("╹▀")
    expect(rows[one + 5]).toContain("tab switch")
    expect(rows[one + 5].trimEnd().endsWith("esc/enter save")).toBe(true)
    expect(rows[one + 5].trimEnd().length).toBe(rows[one + 4].trimEnd().length)
    const dialog = rows.slice(action, one + 6).join("\n")
    expect(dialog).not.toContain("Build")
  })
})

test("undo takes back an edit made in the dialog", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press("X")
    await close(rig)
    await rig.press(UNDO)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(await submitted(rig)).toBe("see one\ntwo\nthree ")
  })
})

// The dialog starts a quarter of the way down the screen, so its editor gets only the rows below
// that: a long paste scrolls inside it and the buttons and the hint stay on screen.
test.each([16, 24, 60])("a 50-line paste keeps the buttons on screen at %i rows", async (height) => {
  await withPrompt(
    async (rig) => {
      const text = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n")
      await rig.press(`\x1b[200~${text}\x1b[201~`)
      expect(rig.text()).toBe("[Pasted ~50 lines] ")
      const at = find(rig, "[Pasted ~50 lines]")
      await rig.click(at.x, at.y)
      const lines = rig.frame().split("\n")
      expect(lines.length).toBeLessThanOrEqual(height + 1)
      expect(lines.findIndex((line) => line.includes("Pasted text 50 lines"))).toBeGreaterThanOrEqual(0)
      expect(find(rig, "esc/enter save").y).toBeLessThan(height)
      const button = find(rig, "Insert inline")
      expect(button.y).toBeLessThan(height)
      await rig.click(button.x, button.y)
      await closed(rig)
      expect(rig.text()).toBe(`${text} `)
    },
    { height },
  )
})
