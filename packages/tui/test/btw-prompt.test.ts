import { expect, test } from "bun:test"
import type { EditorSelection } from "../src/context/editor"
import { btwInstructions, btwPrompt } from "../src/feature-plugins/prompt/btw-prompt"

function range(
  start: { line: number; character?: number },
  end: { line: number; character?: number },
  text: string,
): EditorSelection["ranges"][number] {
  return {
    text,
    selection: {
      start: { line: start.line, character: start.character ?? 0 },
      end: { line: end.line, character: end.character ?? 0 },
    },
  }
}

function selection(ranges: EditorSelection["ranges"]): EditorSelection {
  return { filePath: "src/example.ts", ranges }
}

test("a side question without an editor selection keeps the plain prompt", () => {
  expect(btwPrompt("which file did I select?")).toBe(`${btwInstructions}\n\nwhich file did I select?`)
})

test("a side question carries the pending editor selection", () => {
  const prompt = btwPrompt(
    "which file and lines did I select?",
    selection([range({ line: 24 }, { line: 25 }, "const a = 1\nconst b = 2")]),
  )

  expect(prompt).toContain('<system-reminder>Note: The user selected #24-25 from "src/example.ts".')
  expect(prompt).toContain("const a = 1\nconst b = 2")
  expect(prompt.endsWith(`${btwInstructions}\n\nwhich file and lines did I select?`)).toBe(true)
})

test("a side question carries every selected range", () => {
  const prompt = btwPrompt(
    "what is selected?",
    selection([
      range({ line: 1 }, { line: 2 }, "one"),
      range({ line: 9, character: 0 }, { line: 9, character: 5 }, "two"),
    ]),
  )

  expect(prompt).toContain("Selection 1: #1-2")
  expect(prompt).toContain("Selection 2: #9")
})

test("an opened file without a range still tells the model about it", () => {
  const prompt = btwPrompt("what file is open?", selection([range({ line: 7 }, { line: 7 }, "")]))

  expect(prompt).toContain('<system-reminder>Note: The user opened the file "src/example.ts".')
  expect(prompt).not.toContain("The user selected")
})
