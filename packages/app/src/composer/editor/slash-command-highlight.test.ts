import { expect, test } from "bun:test"
import { findComposerSlashCommandRange } from "./slash-command-highlight"

const commands = [
  { id: "builtin.goal", kind: "command" as const, label: "/goal", trigger: "goal" },
  { id: "custom.review", kind: "command" as const, label: "/review", trigger: "review" },
  { id: "skill.goal", kind: "skill" as const, label: "goal", trigger: "goal" },
]

test.each([
  { text: "/goal", end: 5 },
  { text: "/goal explain the task", end: 5 },
  { text: "/review changes", end: 7 },
])("highlights the known command in $text", ({ text, end }) => {
  const editor = document.createElement("div")
  editor.textContent = text
  const original = editor.innerHTML
  const range = findComposerSlashCommandRange(editor, commands)

  expect(range?.toString()).toBe(text.slice(0, end))
  expect(range?.startContainer).toBe(editor.firstChild ?? undefined)
  expect(range?.startOffset).toBe(0)
  expect(range?.endOffset).toBe(end)
  expect(editor.innerHTML).toBe(original)
})

test.each(["/not-a-command text", "plain /goal text", "/goalish text", " /goal text", "@mention"])(
  "does not highlight %s",
  (text) => {
    const editor = document.createElement("div")
    editor.textContent = text

    expect(findComposerSlashCommandRange(editor, commands)).toBeUndefined()
  },
)

test("does not highlight a command after a line break or mention", () => {
  const editor = document.createElement("div")
  const mention = document.createElement("span")
  mention.dataset.mention = "agent"
  mention.textContent = "@agent"
  editor.append(document.createElement("br"), document.createTextNode("/goal"))

  expect(findComposerSlashCommandRange(editor, commands)).toBeUndefined()

  editor.replaceChildren(mention, document.createTextNode("/goal"))

  expect(findComposerSlashCommandRange(editor, commands)).toBeUndefined()
})
