import { expect, setDefaultTimeout, test } from "bun:test"
import { wait, withPrompt, type PromptRig } from "../fixture/prompt-app"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(30_000)

const UNDO = "\x1b[45;5u"
const ESCAPE = "\x1b"
const ENTER = "\r"
const SPACE = " "
const DOWN = "\x1b[B"
const UP = "\x1b[A"
const TAB = "\t"
const RIGHT = "\x1b[C"
const LEFT = "\x1b[D"
const config = { prompt: { paste_mode: "dialog" as const } }
const code = "    def f():\n        return 1\n"

function find(rig: PromptRig, label: string) {
  const lines = rig.frame().split("\n")
  const y = lines.findIndex((line) => line.includes(label))
  if (y === -1) throw new Error(`"${label}" is not on screen:\n${rig.frame()}`)
  return { x: lines[y].indexOf(label) + 2, y }
}

async function paste(rig: PromptRig, text: string) {
  await rig.press(`\x1b[200~${text}\x1b[201~`)
  await wait(() => rig.frame().includes("enter paste"))
}

async function closed(rig: PromptRig) {
  await wait(() => !rig.frame().includes("enter paste"))
}

// What the prompt sends, which is its text with each placeholder's text in its place.
async function submitted(rig: PromptRig) {
  await rig.press(ENTER)
  await wait(() => rig.sent.length > 0)
  return JSON.parse(rig.sent[0]).parts.find((part: { type: string }) => part.type === "text").text
}

// The option rows are, in order: insert inline, ```, `, >, trim, normalize indents, remove indents,
// collapse, join into one line, ANSI.
async function select(rig: PromptRig, index: number) {
  for (let step = 0; step < index; step++) await rig.press(DOWN)
}

test("a paste opens the dialog, and its preview follows the options", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, code)
      expect(rig.text()).toBe("")
      expect(rig.frame()).toContain("[ ] insert inline")
      expect(rig.frame()).toMatch(/┃\s+ {4}def f\(\):/)
      await select(rig, 5)
      await rig.press(SPACE)
      expect(rig.frame()).toContain("[x] normalize indents")
      expect(rig.frame()).toMatch(/┃\s{2}def f\(\):/)
      await select(rig, 6) // down six more wraps round to ```
      await rig.press(SPACE)
      expect(rig.frame()).toContain("[x] wrap with ```")
      expect(rig.frame()).toMatch(/┃\s{2}```/)
      await rig.press(ENTER)
      await closed(rig)
      // Without trim the copied line's newline stays, as a blank line before the closing fence.
      expect(rig.text()).toBe("[Pasted ~5 lines] ")
      expect(await submitted(rig)).toBe("```\ndef f():\n    return 1\n\n``` ")
    },
    { config },
  )
})

test("inline code is greyed out and cannot be turned on for more than one line", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb")
      await select(rig, 2)
      await rig.press(SPACE)
      expect(rig.frame()).toContain("[ ] wrap with `")
      await rig.press(ENTER)
      await closed(rig)
      expect(await submitted(rig)).toBe("a\nb ")
    },
    { config },
  )
})

test("insert inline puts the text in the prompt, and the choice is kept for the next paste", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "one\ntwo")
      await rig.press(SPACE)
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("one\ntwo")
      await paste(rig, "three")
      expect(rig.frame()).toContain("[x] insert inline")
      await rig.press(ESCAPE)
      await closed(rig)
      expect(rig.text()).toBe("one\ntwo")
    },
    { config },
  )
})

test("the options last chosen are read back from kv", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "x")
      expect(rig.frame()).toContain("[x] quote with >")
      expect(rig.frame()).toMatch(/┃\s+> x/)
    },
    { config, kv: { paste_options: { quote: true } } },
  )
})

test("undo right after a paste takes it back and reopens the dialog with it", async () => {
  await withPrompt(
    async (rig) => {
      for (const char of "see") await rig.press(char)
      await paste(rig, "a\nb\nc")
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("see[Pasted ~3 lines] ")
      await rig.press(UNDO)
      await wait(() => rig.frame().includes("enter paste"))
      await rig.press(SPACE)
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("seea\nb\nc")
    },
    { config },
  )
})

test("a click on a placeholder reopens it with its options, and esc leaves it as it was", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb\nc")
      await select(rig, 3)
      await rig.press(SPACE)
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.parts()).toBe(1)
      const at = find(rig, "[Pasted ~3 lines]")
      await rig.click(at.x, at.y)
      await wait(() => rig.frame().includes("enter paste"))
      expect(rig.frame()).toContain("[x] quote with >")
      await rig.press(SPACE) // the selection starts on insert inline
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("> a\n> b\n> c ")
      await rig.press(UNDO)
      const again = find(rig, "[Pasted ~3 lines]")
      await rig.click(again.x, again.y)
      await wait(() => rig.frame().includes("enter paste"))
      await rig.press(ESCAPE)
      await closed(rig)
      expect(await submitted(rig)).toBe("> a\n> b\n> c ")
    },
    { config },
  )
})

test("tab moves to the editor, where space and letters type and enter still pastes", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb\nc")
      await rig.press(TAB)
      for (const char of "X Y") await rig.press(char)
      await rig.press(TAB)
      await rig.press(UP) // back in the options: wraps round to the last one
      await rig.press(TAB)
      await rig.press(ENTER)
      await closed(rig)
      expect(await submitted(rig)).toBe("X Ya\nb\nc ")
    },
    { config },
  )
})

// Every cleanup changes this text: blank lines at both ends and in a run, trailing spaces, a shared
// four-space indent and terminal colors.
const messy = "\n\n    alpha   \n\n\n\n        beta  \n    \x1b[31mgamma\x1b[0m\n\n"
const keys = ["fence", "code", "quote", "trim", "dedent", "unindent", "collapse", "join", "ansi"] as const

// Moves the selection to an option row and toggles it, tracking the row the selection is on.
function options(rig: PromptRig) {
  let row = 0
  return async (key: (typeof keys)[number] | "inline") => {
    const target = ["inline", ...keys].indexOf(key)
    while (row < target) await rig.press(DOWN), row++
    while (row > target) await rig.press(UP), row--
    await rig.press(SPACE)
  }
}

// With insert inline on the result goes in as typed, so the prompt holds exactly what the dialog had.
async function pastesBack(rig: PromptRig, toggle: (key: "inline") => Promise<void>) {
  await toggle("inline")
  await rig.press(ENTER)
  await closed(rig)
  expect(rig.text()).toBe(messy)
}

test.each([...keys])("turning %s on and off gives back the paste as it was", async (key) => {
  await withPrompt(
    async (rig) => {
      await paste(rig, messy)
      const toggle = options(rig)
      await toggle(key)
      await toggle(key)
      await pastesBack(rig, toggle)
    },
    { config },
  )
})

test("every option on, then off in reverse and in a shuffled order, gives back the paste", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, messy)
      const toggle = options(rig)
      for (const key of keys) await toggle(key)
      expect(rig.frame()).toMatch(/┃\s+> ```/)
      for (const key of [...keys].reverse()) await toggle(key)
      // A fixed shuffle, so a failure can be replayed.
      // Join makes the paste one line, so inline code can go on and replaces the code block; collapse
      // is greyed out under join and stays off.
      const shuffled = ["dedent", "join", "fence", "ansi", "unindent", "trim", "quote", "collapse", "code"] as const
      for (const key of shuffled) await toggle(key)
      expect(rig.frame()).toMatch(/┃\s+> `alpha beta gamma`/)
      // Normalize indents is greyed out until remove indents is off, so it goes off last.
      for (const key of ["code", "trim", "join", "ansi", "quote", "unindent", "dedent"] as const) await toggle(key)
      await pastesBack(rig, toggle)
    },
    { config },
  )
})

test("right moves to the editor and tab back; focus and caret moves there are not edits", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, messy)
      const toggle = options(rig)
      await toggle("trim")
      await rig.press(RIGHT)
      await wait(() => rig.frame().includes("tab options"))
      for (const key of [DOWN, DOWN, RIGHT, RIGHT, LEFT, UP]) await rig.press(key)
      await rig.press(TAB)
      await wait(() => rig.frame().includes("→/tab edit"))
      await toggle("trim")
      await rig.press(TAB)
      await rig.press(TAB)
      await pastesBack(rig, toggle)
    },
    { config },
  )
})

test("remove indents greys out normalize indents, and join greys out collapse blank lines", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "  a\n\n\n    b")
      const toggle = options(rig)
      await toggle("unindent")
      await toggle("dedent") // greyed out: stays off
      expect(rig.frame()).toContain("[x] remove indents")
      expect(rig.frame()).toContain("[ ] normalize indents")
      await toggle("join")
      await toggle("collapse") // greyed out: stays off
      expect(rig.frame()).toContain("[ ] collapse blank lines")
      await toggle("code") // one line now, so inline code can go on
      expect(rig.frame()).toMatch(/┃\s+`a b`/)
      await toggle("inline")
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("`a b`")
    },
    { config },
  )
})

// The dialog starts a quarter of the way down, so a 16-row screen leaves the options 6 rows: the list
// scrolls to keep the selection on screen.
test("on a short screen the options scroll with the selection", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb")
      expect(rig.frame()).toContain("[ ] insert inline")
      expect(rig.frame()).not.toContain("strip ANSI escapes")
      await select(rig, 9)
      expect(rig.frame()).toContain("strip ANSI escapes")
      expect(rig.frame()).not.toContain("insert inline")
      expect(rig.frame()).toContain("enter paste")
      await rig.press(DOWN) // wraps round to the first
      expect(rig.frame()).toContain("insert inline")
    },
    { config, height: 16 },
  )
})

test("right arrow in the editor moves the caret instead of leaving it", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "ab")
      await rig.press(RIGHT)
      await rig.press(RIGHT)
      await rig.press("X")
      await rig.press(TAB)
      await rig.press(SPACE) // insert inline
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("aXb")
    },
    { config },
  )
})

test("esc on a new paste puts nothing in the prompt", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb\nc")
      await rig.press(ESCAPE)
      await closed(rig)
      expect(rig.text()).toBe("")
      expect(rig.parts()).toBe(0)
    },
    { config },
  )
})
