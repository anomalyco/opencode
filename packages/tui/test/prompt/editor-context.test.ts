import { expect, test } from "bun:test"
import type { EditorSelection } from "../../src/context/editor"
import { userPromptText, withEditorContext } from "../../src/prompt/editor-context"

const selection: EditorSelection = {
  filePath: "/workspace/src/index.ts",
  source: "zed",
  ranges: [
    {
      text: "const value = 1",
      selection: {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 15 },
      },
    },
  ],
}

test("keeps editor context model-visible and user-authored text display-visible", () => {
  const prompt = withEditorContext(selection, "Explain this")

  expect(prompt.text).toContain('<system-reminder>Note: The user selected #4 from "/workspace/src/index.ts".')
  expect(prompt.text).toEndWith("Explain this")
  expect(userPromptText(prompt)).toBe("Explain this")
})

test("hides opened-file context from the displayed prompt", () => {
  const prompt = withEditorContext({ ...selection, ranges: [] }, "Explain this")

  expect(prompt.text).toContain('<system-reminder>Note: The user opened the file "/workspace/src/index.ts".')
  expect(userPromptText(prompt)).toBe("Explain this")
})

test("preserves ordinary user messages", () => {
  expect(userPromptText({ text: "Explain this" })).toBe("Explain this")
  expect(userPromptText({ text: "Explain this", metadata: { "tui.editorContext": true } })).toBe("Explain this")
})
